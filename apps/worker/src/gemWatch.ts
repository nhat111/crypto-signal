import type { Pool } from 'pg';
import type { Logger } from '@crypto-signal/shared';
import { DexScreenerSource, describeWatchReason, evaluateWatch, type SafetyVerdict, type WatchTriggerReason } from '@crypto-signal/gem-scanner';
import { closeGemWatch, getAllActiveWatches, getGemByAddress, type GemWatchRow } from '@crypto-signal/db';
import type { TelegramNotifier } from './telegramNotifier.js';

export interface GemWatchDeps {
  pool: Pool;
  logger: Logger;
  notifier: TelegramNotifier;
}

/**
 * Periodic sell-condition check for every active "/watch SYMBOL" position.
 * Price/liquidity come from a fresh DexScreener fetch every pass — cheap
 * and unauthenticated. Risk/safety come from whatever the regular scan
 * pipeline most recently recorded (getGemByAddress), never from a fresh
 * RugCheck call here: RugCheck is the slow, rate-limited dependency, and a
 * position watch has no business spending that budget on its own schedule.
 */
export async function runGemWatchCycle(deps: GemWatchDeps): Promise<void> {
  const { pool, logger, notifier } = deps;

  const watches = await getAllActiveWatches(pool);
  if (watches.length === 0) return;

  const dexscreener = new DexScreenerSource({ logger });

  const byChain = new Map<string, GemWatchRow[]>();
  for (const watch of watches) {
    const list = byChain.get(watch.chainId) ?? [];
    list.push(watch);
    byChain.set(watch.chainId, list);
  }

  let triggeredCount = 0;

  for (const [chainId, chainWatches] of byChain) {
    try {
      const pairs = await dexscreener.fetchPairsForTokens(chainId, chainWatches.map((w) => w.tokenAddress));
      const byToken = new Map(pairs.map((p) => [p.baseToken.address, p]));

      for (const watch of chainWatches) {
        const pair = byToken.get(watch.tokenAddress);

        // No pair at all usually means the pool is gone — itself the
        // clearest possible sell signal, same read as the outcome tracker
        // uses for gem_scans (redisCache.ts has no equivalent; see gemScan.ts).
        if (!pair || pair.priceUsd === null) {
          await closeGemWatch(pool, watch.id, 'triggered', ['pool_gone']);
          await notifier.send(watch.chatId, formatWatchAlert(watch, null, ['pool_gone']));
          triggeredCount += 1;
          continue;
        }

        const latestScan = await getGemByAddress(pool, watch.chainId, watch.tokenAddress);

        // Thresholds come from the watch row itself, not the worker's live
        // GEM_WATCH_* config — they were snapshotted at /watch time
        // specifically so a later env change never silently moves the
        // goalposts on a position someone already armed (see migration
        // 005's comment).
        const reasons = evaluateWatch(
          { entryPrice: watch.entryPrice, entryLiquidityUsd: watch.entryLiquidityUsd },
          {
            priceUsd: pair.priceUsd,
            liquidityUsd: pair.liquidityUsd,
            riskScore: latestScan?.riskScore ?? null,
            safetyVerdict: (latestScan?.safetyVerdict as SafetyVerdict | null) ?? null,
          },
          {
            stopLossPct: watch.stopLossPct,
            takeProfitPct: watch.takeProfitPct,
            liquidityCollapsePct: watch.liquidityCollapsePct,
            riskScoreAlert: watch.riskScoreAlert,
          },
        );

        if (reasons.length > 0) {
          await closeGemWatch(pool, watch.id, 'triggered', reasons);
          await notifier.send(watch.chatId, formatWatchAlert(watch, pair.priceUsd, reasons));
          triggeredCount += 1;
        }
      }
    } catch (err) {
      logger.warn({ err, chainId }, 'gem watch check failed for this chain');
    }
  }

  logger.info({ checked: watches.length, triggered: triggeredCount }, 'gem watch cycle complete');
}

function formatWatchAlert(watch: GemWatchRow, currentPrice: number | null, reasons: WatchTriggerReason[]): string {
  const pnlPct = currentPrice === null ? null : ((currentPrice - watch.entryPrice) / watch.entryPrice) * 100;

  const lines = [
    '🔔 <b>WATCH ALERT — consider selling</b>',
    '',
    `<b>${escapeHtml(watch.symbol)}</b> · ${watch.chainId}`,
    `Entry: $${watch.entryPrice}`,
    currentPrice === null
      ? 'Current: pool no longer found on DexScreener'
      : `Current: $${currentPrice}  (${pnlPct !== null && pnlPct >= 0 ? '+' : ''}${pnlPct?.toFixed(1)}%)`,
    '',
    '<b>Why:</b>',
    ...reasons.map((r, i) => `${i + 1}. ${describeWatchReason(r)}`),
    '',
    '<i>This watch is now closed — /watch it again if you want to keep tracking it.</i>',
  ];
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
