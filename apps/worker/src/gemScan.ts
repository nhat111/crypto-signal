import type { Pool } from 'pg';
import type { Logger } from '@crypto-signal/shared';
import {
  DexScreenerSource,
  GeckoTerminalSource,
  RugCheckSource,
  runScan,
  type GemConfig,
  type ScoredGem,
} from '@crypto-signal/gem-scanner';
import {
  ensureGemOutcome,
  getAllAlertSubscribers,
  getGemsPendingOutcome,
  getLastGemAlert,
  insertGemAlertEvent,
  insertGemScan,
  pruneOldGemScans,
  recordGemOutcome,
  upsertGemToken,
  type GemHorizon,
} from '@crypto-signal/db';
import type { TelegramNotifier } from './telegramNotifier.js';

export interface GemScanDeps {
  pool: Pool;
  logger: Logger;
  gemConfig: GemConfig;
  notifier: TelegramNotifier;
  telegramAlertChatIds: string[];
}

/**
 * Wires the gem scanner's sources and runs one pass per configured chain.
 *
 * Lives in the worker alongside the Binance collector for the same reason
 * everything else does: it's background work that must never sit in an API
 * request path. It shares nothing with the market-health pipeline beyond
 * the process and the database.
 */
export async function runGemScanCycle(deps: GemScanDeps): Promise<void> {
  const { logger, gemConfig } = deps;

  const dexscreener = new DexScreenerSource({ logger });
  const geckoterminal = new GeckoTerminalSource({ logger });
  const rugcheck = new RugCheckSource({ logger, apiKey: gemConfig.rugcheckApiKey || undefined });

  for (const chainId of gemConfig.chains) {
    try {
      const result = await runScan(
        {
          discoverySources: [dexscreener, geckoterminal],
          pairSource: dexscreener,
          safetySource: rugcheck,
          config: gemConfig,
          logger,
        },
        chainId,
      );

      for (const gem of result.eligible) {
        await persistAndMaybeAlert(deps, gem, result.scannedAt);
      }

      logger.info(
        { chainId, candidates: result.candidateCount, eligible: result.eligible.length, rejected: result.rejectedCount },
        'gem scan cycle complete',
      );
    } catch (err) {
      logger.error({ err, chainId }, 'gem scan cycle failed');
    }
  }
}

async function persistAndMaybeAlert(deps: GemScanDeps, gem: ScoredGem, scannedAt: number): Promise<void> {
  const { pool, logger, gemConfig } = deps;
  const { pair, evaluation } = gem;

  await upsertGemToken(pool, pair);
  const scanId = await insertGemScan(pool, { pair, evaluation, safety: gem.safety, scannedAt });

  const score = evaluation.score ?? 0;
  if (score < gemConfig.alert.minScore) return;

  // Outcome rows exist only for tokens the scanner actually called, so the
  // performance page answers "when this flagged something, what happened?"
  // rather than being diluted by every routine rescan.
  if (pair.priceUsd !== null) {
    await ensureGemOutcome(pool, scanId, pair.priceUsd, pair.liquidityUsd);
  }

  const lastAlert = await getLastGemAlert(pool, pair.chainId, pair.baseToken.address);
  const cooldownMs = gemConfig.alert.cooldownHours * 60 * 60 * 1000;
  if (lastAlert && Date.now() - lastAlert.sentAt < cooldownMs) return;

  const text = formatGemAlert(gem);
  const subscribers = await getAllAlertSubscribers(pool);
  const chatIds = Array.from(
    new Set([...deps.telegramAlertChatIds, ...subscribers.filter((s) => s.alertsEnabled).map((s) => s.chatId)]),
  );

  if (chatIds.length === 0) {
    await insertGemAlertEvent(pool, scanId, pair.chainId, pair.baseToken.address, score, null);
    return;
  }

  for (const chatId of chatIds) {
    await deps.notifier.send(chatId, text);
    await insertGemAlertEvent(pool, scanId, pair.chainId, pair.baseToken.address, score, chatId);
  }

  logger.info({ symbol: pair.baseToken.symbol, score, riskScore: evaluation.riskScore }, 'gem alert sent');
}

export function formatGemAlert(gem: ScoredGem): string {
  const { pair, evaluation } = gem;
  const lines = [
    '💎 <b>SMALL-CAP CANDIDATE</b>',
    '',
    `<b>${escapeHtml(pair.baseToken.symbol)}</b> — ${escapeHtml(pair.baseToken.name)}`,
    `${pair.chainId} · ${pair.dexId}`,
    '',
    `Gem Score: ${evaluation.score}/100`,
    `Risk Score: ${evaluation.riskScore}/100`,
    '',
    '<b>Why:</b>',
    ...evaluation.reasons.map((r, i) => `${i + 1}. ${escapeHtml(r)}`),
  ];
  if (pair.url) lines.push('', pair.url);
  return lines.join('\n');
}

/** Token names come from on-chain metadata that anyone can set, so they're escaped before going into an HTML-parsed message. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const HORIZONS: GemHorizon[] = ['24h', '7d'];

/**
 * Fills in what actually happened after each surfaced token, using a fresh
 * price from the same source that produced the original scan.
 */
export async function runGemOutcomeTracker(deps: GemScanDeps): Promise<void> {
  const { pool, logger, gemConfig } = deps;
  const dexscreener = new DexScreenerSource({ logger });
  const now = Date.now();

  for (const horizon of HORIZONS) {
    const pending = await getGemsPendingOutcome(pool, horizon, now);
    if (pending.length === 0) continue;

    // Group by chain so each chain's addresses batch into as few calls as possible.
    const byChain = new Map<string, typeof pending>();
    for (const row of pending) {
      const list = byChain.get(row.chainId) ?? [];
      list.push(row);
      byChain.set(row.chainId, list);
    }

    for (const [chainId, rows] of byChain) {
      try {
        const pairs = await dexscreener.fetchPairsForTokens(chainId, rows.map((r) => r.tokenAddress));
        const byToken = new Map(pairs.map((p) => [p.baseToken.address, p]));

        for (const row of rows) {
          const pair = byToken.get(row.tokenAddress);
          // No current pair usually means the pool is gone — which is itself
          // the outcome. Recording price 0 would assert a price we never
          // observed, so it's left pending and reported as unresolved.
          if (!pair || pair.priceUsd === null) continue;
          await recordGemOutcome(pool, row.scanId, horizon, pair.priceUsd, row.priceAtScan, pair.liquidityUsd);
        }
      } catch (err) {
        logger.warn({ err, chainId, horizon }, 'gem outcome tracking failed for this chain');
      }
    }

    logger.info({ horizon, count: pending.length }, 'gem outcome tracker pass complete');
  }

  if (gemConfig.enabled) {
    const pruned = await pruneOldGemScans(pool, 30);
    if (pruned > 0) logger.info({ pruned }, 'pruned old gem scan rows');
  }
}
