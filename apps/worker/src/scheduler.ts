import {
  HEARTBEAT_INTERVAL_MS,
  RUNTIME_WORKER,
  computeSignalVerdicts,
  countPendingOutcomes,
  getHistoricalScoreForSignalType,
  getResolvableOutcomes,
  pruneOldLiquidations,
  recordOutcomePrice,
  recordWorkerHeartbeat,
  saveSignalVerdicts,
  type OutcomeHorizon,
} from '@crypto-signal/db';
import { ALL_SIGNAL_TYPES, type SignalType } from '@crypto-signal/signal-engine';
import { processMatchedCandles } from './pipeline.js';
import { runGemOutcomeTracker, runGemScanCycle, type GemScanDeps } from './gemScan.js';
import { runGemWatchCycle, type GemWatchDeps } from './gemWatch.js';
import { runHealthAlertCycle } from './healthAlerts.js';
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
    // Only rows that can actually be priced are handed back, so a signal
    // whose candle is missing cannot sit at the head of the queue and
    // starve everything behind it (see getResolvableOutcomes).
    const resolvable = await getResolvableOutcomes(ctx.pool, horizon, now);

    for (const row of resolvable) {
      await recordOutcomePrice(ctx.pool, row.signalId, horizon, row.closeAtHorizon, row.priceAtSignal);
    }

    const stillPending = await countPendingOutcomes(ctx.pool, horizon, now);
    if (resolvable.length > 0 || stillPending > 0) {
      // `stillPending` counts rows that are due but unpriceable as well as
      // ones simply not reached yet — a number that keeps growing means
      // candle coverage has a hole, which is worth seeing.
      ctx.logger.info({ horizon, recorded: resolvable.length, stillPending }, 'outcome tracker updated signals');
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

/**
 * Re-judges every signal type against the baseline and caches the result.
 *
 * The judgement itself is not new — /performance has made it per request
 * for a while. What is new is that the dashboard and the Telegram alert
 * can now read it, and neither could afford to compute it: the baseline
 * is a lateral join across every 5m candle in the measured window.
 *
 * Hourly is generous. Outcomes resolve on a 5-minute tracker and the
 * sample counts here are in the thousands, so an hour of staleness cannot
 * move a verdict — and a verdict that would flip within an hour was never
 * a verdict worth showing.
 */
export async function refreshSignalVerdicts(ctx: WorkerContext): Promise<void> {
  const verdicts = await computeSignalVerdicts(ctx.pool, ALL_SIGNAL_TYPES);
  await saveSignalVerdicts(ctx.pool, verdicts);
  // Replaced wholesale, not merged: a type that has fallen below the
  // sample threshold must lose its verdict rather than keep the last one.
  ctx.signalVerdicts.clear();
  for (const v of verdicts) ctx.signalVerdicts.set(v.signalType as SignalType, v);
  const worse = verdicts.filter((v) => v.verdict === 'worse').map((v) => v.signalType);
  ctx.logger.info({ judged: verdicts.length, worse }, 'signal verdicts refreshed');
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
  timers.push(setInterval(() => void refreshSignalVerdicts(ctx).catch((err) => ctx.logger.error({ err }, 'signal verdict refresh failed')), 60 * 60_000));
  timers.push(setInterval(() => void runRetention(ctx).catch((err) => ctx.logger.error({ err }, 'retention job failed')), 24 * 60 * 60_000));
  timers.push(setInterval(() => void resolveTimedOutPairs(ctx).catch((err) => ctx.logger.error({ err }, 'pair buffer timeout resolution failed')), 5_000));

  // Publishes what the sockets are doing, because nothing outside this
  // process can see ctx.connectionStatus. Failure is logged and dropped:
  // a heartbeat that could not be written is a worse thing to crash the
  // collector over than to go quiet about, and its own staleness is what
  // the reader is checking anyway.
  const beat = (): void => {
    void recordWorkerHeartbeat(ctx.pool, RUNTIME_WORKER, {
      spot: ctx.connectionStatus.spot,
      futures: ctx.connectionStatus.futures,
      liquidation: ctx.connectionStatus.liquidation,
    }, ctx.symbolIngest).catch((err) => ctx.logger.error({ err }, 'worker heartbeat failed'));
  };
  timers.push(setInterval(beat, HEARTBEAT_INTERVAL_MS));
  beat();

  // Pushed rather than pulled: the status page answers every one of these
  // questions and answers none of them at three in the morning. Fifteen
  // minutes matches the staleness window it reports on, so an alert never
  // fires for something the page would still call healthy.
  const alertDeps = {
    pool: ctx.pool,
    logger: ctx.logger,
    notifier: ctx.notifier,
    chatIds: ctx.config.telegramAlertChatIds,
  };
  timers.push(
    setInterval(
      () => void runHealthAlertCycle(alertDeps).catch((err) => ctx.logger.error({ err }, 'health alert cycle failed')),
      15 * 60_000,
    ),
  );

  void refreshHistoricalScores(ctx).catch((err) => ctx.logger.error({ err }, 'initial historical score refresh failed'));
  // On boot too: a fresh deploy would otherwise show no verdicts anywhere
  // for an hour, which reads identically to "nothing has been concluded".
  void refreshSignalVerdicts(ctx).catch((err) => ctx.logger.error({ err }, 'initial signal verdict refresh failed'));

  return () => timers.forEach(clearInterval);
}
