import {
  getHistoricalScoreForSignalType,
  getCandleAtOrAfter,
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

const HORIZON_MS: Record<OutcomeHorizon, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

/**
 * How far past a signal's due time a candle may be and still answer "what
 * was the price at signal + horizon". Six 5m candles: enough slack for an
 * ordinary gap in collection, far too little to let a price from a later
 * outage be passed off as the answer.
 */
const OUTCOME_LOOKAHEAD_MS = 30 * 60_000;

/**
 * Phase 9 historical validation: fills price_after_* columns once each
 * horizon has actually elapsed.
 *
 * The price is looked up at the candle covering **signal time + horizon**,
 * not at whatever candle is newest when this happens to run. Those are the
 * same thing only while the job keeps up; when the worker is down or stuck
 * (as it has been), the backlog would otherwise be priced at the moment of
 * recovery — quietly filling /performance, the one surface whose whole
 * purpose is honest evidence, with numbers measured over the wrong window.
 *
 * Never fabricates a price: a signal with no futures candle near its due
 * time is left unresolved rather than resolved wrongly.
 */
export async function runOutcomeTracker(ctx: WorkerContext): Promise<void> {
  const now = Date.now();
  for (const horizon of HORIZONS) {
    const pending = await getSignalsPendingOutcome(ctx.pool, horizon, now);
    let recorded = 0;

    for (const row of pending) {
      const dueAtMs = row.signalTimestamp + HORIZON_MS[horizon];
      const candle = await getCandleAtOrAfter(ctx.pool, row.symbol, 'futures', '5m', dueAtMs, OUTCOME_LOOKAHEAD_MS);
      if (!candle) continue;
      await recordOutcomePrice(ctx.pool, row.signalId, horizon, candle.close, row.priceAtSignal);
      recorded += 1;
    }

    if (pending.length > 0) {
      // `pending` and `recorded` differ when candles near the due time are
      // missing — worth seeing, since a persistent gap means outcomes are
      // silently not accumulating.
      ctx.logger.info({ horizon, pending: pending.length, recorded }, 'outcome tracker updated signals');
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
