import {
  getHistoricalScoreForSignalType,
  getRecentCandles,
  getSignalsPendingOutcome,
  pruneOldLiquidations,
  recordOutcomePrice,
  type OutcomeHorizon,
} from '@crypto-signal/db';
import { ALL_SIGNAL_TYPES } from '@crypto-signal/signal-engine';
import { processMatchedCandles } from './pipeline.js';
import { runGemOutcomeTracker, runGemScanCycle, type GemScanDeps } from './gemScan.js';
import { runGemWatchCycle, type GemWatchDeps } from './gemWatch.js';
import { runStablecoinFlowCycle } from './stablecoinFlow.js';
import type { WorkerContext } from './context.js';

const HORIZONS: OutcomeHorizon[] = ['15m', '1h', '4h', '24h'];

/** Phase 9 historical validation: fills price_after_* columns once each horizon has actually elapsed. Never fabricates a price — skips a signal if there's no futures candle yet at/after the due time. */
export async function runOutcomeTracker(ctx: WorkerContext): Promise<void> {
  const now = Date.now();
  for (const horizon of HORIZONS) {
    const pending = await getSignalsPendingOutcome(ctx.pool, horizon, now);
    for (const row of pending) {
      const candles = await getRecentCandles(ctx.pool, row.symbol, 'futures', '5m', 1);
      const latest = candles[0];
      if (!latest) continue;
      await recordOutcomePrice(ctx.pool, row.signalId, horizon, latest.close, row.priceAtSignal);
    }
    if (pending.length > 0) {
      ctx.logger.info({ horizon, count: pending.length }, 'outcome tracker updated signals');
    }
  }
}

export async function refreshHistoricalScores(ctx: WorkerContext): Promise<void> {
  for (const signalType of ALL_SIGNAL_TYPES) {
    const score = await getHistoricalScoreForSignalType(ctx.pool, signalType);
    if (score !== undefined) ctx.historicalScores.set(signalType, score);
    else ctx.historicalScores.delete(signalType);
  }
}

export async function runRetention(ctx: WorkerContext): Promise<void> {
  const deleted = await pruneOldLiquidations(ctx.pool, 30);
  if (deleted > 0) ctx.logger.info({ deleted }, 'pruned old liquidation rows');
}

/**
 * Resolves candle pairs that timed out waiting for their other market side
 * (spec §29 "REST fallback"): fetches the missing candle directly instead
 * of waiting indefinitely for a WS message that may never arrive.
 */
export async function resolveTimedOutPairs(ctx: WorkerContext): Promise<void> {
  const timedOut = ctx.pairBuffer.timedOutEntries();
  for (const entry of timedOut) {
    try {
      const adapter = entry.missing === 'spot' ? ctx.spotAdapter : ctx.futuresAdapter;
      const candles = await adapter.fetchKlines(entry.symbol, entry.timeframe, { startTime: entry.openTime, limit: 1 });
      const candle = candles.find((c) => c.openTime === entry.openTime);
      if (!candle) {
        ctx.logger.warn(entry, 'REST fallback could not find candle either — dropping this bucket');
        ctx.pairBuffer.drop(entry.symbol, entry.timeframe, entry.openTime);
        continue;
      }
      const pair = ctx.pairBuffer.add(candle);
      if (pair) await processMatchedCandles(ctx, pair.spot, pair.futures);
    } catch (err) {
      ctx.logger.warn({ err, entry }, 'REST fallback fetch failed, will retry next tick');
    }
  }
}

export function startSchedulers(ctx: WorkerContext): () => void {
  const timers: ReturnType<typeof setInterval>[] = [];

  // Small-cap discovery is opt-in (GEM_SCAN_ENABLED) and completely
  // independent of the Binance pipeline — a failure in one must not affect
  // the other, so it gets its own timers and its own try/catch.
  if (ctx.gemConfig?.enabled) {
    const gemDeps: GemScanDeps = {
      pool: ctx.pool,
      logger: ctx.logger,
      gemConfig: ctx.gemConfig,
      notifier: ctx.notifier,
      telegramAlertChatIds: ctx.config.telegramAlertChatIds,
    };
    const intervalMs = ctx.gemConfig.scanIntervalMinutes * 60_000;

    timers.push(setInterval(() => void runGemScanCycle(gemDeps).catch((err) => ctx.logger.error({ err }, 'gem scan failed')), intervalMs));
    timers.push(
      setInterval(
        () => void runGemOutcomeTracker(gemDeps).catch((err) => ctx.logger.error({ err }, 'gem outcome tracker failed')),
        60 * 60_000,
      ),
    );

    void runGemScanCycle(gemDeps).catch((err) => ctx.logger.error({ err }, 'initial gem scan failed'));

    // Position watches run on their own cadence, independent of the
    // discovery scan interval — a stop-loss check shouldn't wait 30
    // minutes just because that's how often new candidates get scanned.
    const watchDeps: GemWatchDeps = { pool: ctx.pool, logger: ctx.logger, notifier: ctx.notifier };
    const watchIntervalMs = ctx.gemConfig.watch.checkIntervalMinutes * 60_000;
    timers.push(setInterval(() => void runGemWatchCycle(watchDeps).catch((err) => ctx.logger.error({ err }, 'gem watch cycle failed')), watchIntervalMs));
  }

  // Macro context, not part of the Binance pipeline — its own timer and
  // try/catch so DefiLlama being unreachable can't disturb candle
  // collection. Daily data, so six-hourly is already more often than it changes.
  const stablecoinDeps = { pool: ctx.pool, logger: ctx.logger };
  timers.push(
    setInterval(
      () => void runStablecoinFlowCycle(stablecoinDeps).catch((err) => ctx.logger.error({ err }, 'stablecoin flow refresh failed')),
      6 * 60 * 60_000,
    ),
  );
  void runStablecoinFlowCycle(stablecoinDeps).catch((err) => ctx.logger.error({ err }, 'initial stablecoin flow refresh failed'));

  timers.push(setInterval(() => void runOutcomeTracker(ctx).catch((err) => ctx.logger.error({ err }, 'outcome tracker failed')), 5 * 60_000));
  timers.push(setInterval(() => void refreshHistoricalScores(ctx).catch((err) => ctx.logger.error({ err }, 'historical score refresh failed')), 10 * 60_000));
  timers.push(setInterval(() => void runRetention(ctx).catch((err) => ctx.logger.error({ err }, 'retention job failed')), 24 * 60 * 60_000));
  timers.push(setInterval(() => void resolveTimedOutPairs(ctx).catch((err) => ctx.logger.error({ err }, 'pair buffer timeout resolution failed')), 5_000));

  void refreshHistoricalScores(ctx).catch((err) => ctx.logger.error({ err }, 'initial historical score refresh failed'));

  return () => timers.forEach(clearInterval);
}
