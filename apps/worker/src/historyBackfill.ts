import type {
  Candle,
  ConfidenceWeights,
  FundingRatePoint,
  HealthWeights,
  OpenInterestPoint,
  RiskWeights,
  SymbolId,
  Thresholds,
  Timeframe,
} from '@crypto-signal/shared';
import { timeframeToMs } from '@crypto-signal/shared';
import { computeFuturesOnlySnapshot, computeMarketSnapshot, computeTrueRange, type MarketSnapshot } from '@crypto-signal/indicators';
import { evaluateSignals, type Signal } from '@crypto-signal/signal-engine';
import { computeHealth, computeRisk } from '@crypto-signal/health-engine';
import {
  countPendingOutcomes,
  getResolvableOutcomes,
  insertFundingRate,
  insertOpenInterest,
  insertSignal,
  recordOutcomePrice,
  type OutcomeHorizon,
  saveFuturesMetrics,
  saveHealthSnapshot,
  saveSpotMetrics,
  upsertCandle,
} from '@crypto-signal/db';
import { assessDataQuality } from './dataQuality.js';

/**
 * Replays the signal engine over historical market data so /performance has
 * something to work with.
 *
 * Why this exists: after weeks of live collection the largest signal type
 * had 53 recorded outcomes — a 95% confidence interval of roughly 42%-68%,
 * which cannot be told apart from a coin flip. Waiting for the sample to
 * grow forward costs months. Every input the engine needs is either stored
 * or fetchable, and every stage of the engine is a pure function, so the
 * same maths can simply be re-run over the past.
 *
 * What a replayed signal is NOT:
 *
 *   * It has no liquidation data. Binance publishes no history for forced
 *     orders — they exist only from the moment a websocket was connected.
 *     LONG_LIQUIDATION and SHORT_LIQUIDATION therefore cannot fire here at
 *     all, and the Health/Risk components fed by liquidations score as if
 *     the market were quiet. Rows are written with source='backfill' and
 *     NULL liquidation figures so nothing downstream can mistake this for
 *     an observation.
 *   * It stops at Binance's open-interest horizon (30 days). Older windows
 *     can still be replayed for the rules that never read OI, but five of
 *     the nine do read it.
 *
 * Determinism: the historical-score term of confidence is deliberately left
 * at its default rather than read from the database. Feeding replayed
 * outcomes back into the confidence of later replayed signals would make
 * the result depend on the order the backfill happened to run in.
 */

/** Matches SymbolTimeframeState.pushVolumeHistory's window, so a replayed candle sees the same rolling average a live one would. */
const WARMUP_CANDLES = 96;

const KLINE_PAGE_LIMIT = 1000;
const OPEN_INTEREST_PAGE_LIMIT = 500;

/** Binance serves /futures/data/openInterestHist for the last 30 days only. Beyond this, OI-dependent rules cannot be replayed. */
export const OPEN_INTEREST_HISTORY_DAYS = 30;

/**
 * Outcomes are priced off futures 5m candles — see `getResolvableOutcomes`.
 * That makes 5m the ruler every horizon is measured with, not one more
 * timeframe to analyse, so the replay needs it stored whether or not 5m is
 * one of the timeframes being scored.
 */
const PRICING_TIMEFRAME: Timeframe = '5m';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackfillDeps {
  pool: import('pg').Pool;
  spotAdapter: {
    fetchKlines(symbol: SymbolId, timeframe: Timeframe, opts: { startTime?: number; endTime?: number; limit?: number }): Promise<Candle[]>;
  };
  futuresAdapter: {
    fetchKlines(symbol: SymbolId, timeframe: Timeframe, opts: { startTime?: number; endTime?: number; limit?: number }): Promise<Candle[]>;
    fetchOpenInterestHist(symbol: SymbolId, timeframe: Timeframe, opts: { limit?: number; startTime?: number; endTime?: number }): Promise<OpenInterestPoint[]>;
    fetchFundingRateHistory(symbol: SymbolId, opts: { limit?: number; startTime?: number; endTime?: number }): Promise<FundingRatePoint[]>;
  };
  thresholds: Thresholds;
  healthWeights: HealthWeights;
  riskWeights: RiskWeights;
  confidenceWeights: ConfidenceWeights;
  futuresOnlySymbolSet: Set<string>;
  logger: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}

export interface BackfillWindowReport {
  symbol: SymbolId;
  timeframe: Timeframe;
  futuresCandles: number;
  spotCandles: number;
  openInterestPoints: number;
  fundingPoints: number;
  /** Candles used only to warm the rolling windows — never evaluated, so the first scored candle sees the same history depth a live one would. */
  warmupCandles: number;
  evaluatedCandles: number;
  signalsWritten: number;
  /** Candles skipped because their spot counterpart was missing — a replayed pair must be genuine, never stitched from mismatched times. */
  unpairedCandles: number;
  /** Candles with no open-interest point in range. Every OI-dependent rule is unevaluable there, so they are skipped rather than scored with a stale value. */
  missingOpenInterest: number;
}

/** Pages forward through klines until the window is covered. Binance returns ascending order, at most `limit` per call. */
async function fetchKlineRange(
  fetch: (symbol: SymbolId, timeframe: Timeframe, opts: { startTime?: number; endTime?: number; limit?: number }) => Promise<Candle[]>,
  symbol: SymbolId,
  timeframe: Timeframe,
  startMs: number,
  endMs: number,
): Promise<Candle[]> {
  const stepMs = timeframeToMs(timeframe);
  const out: Candle[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const page = await fetch(symbol, timeframe, { startTime: cursor, endTime: endMs, limit: KLINE_PAGE_LIMIT });
    if (page.length === 0) break;
    out.push(...page);
    const last = page[page.length - 1] as Candle;
    const next = last.openTime + stepMs;
    if (next <= cursor) break; // upstream stopped advancing — stop rather than spin
    cursor = next;
    if (page.length < KLINE_PAGE_LIMIT) break;
  }

  return out;
}

async function fetchOpenInterestRange(
  deps: BackfillDeps,
  symbol: SymbolId,
  timeframe: Timeframe,
  startMs: number,
  endMs: number,
): Promise<OpenInterestPoint[]> {
  const stepMs = timeframeToMs(timeframe);
  const out: OpenInterestPoint[] = [];
  let cursor = startMs;

  while (cursor < endMs) {
    const page = await deps.futuresAdapter.fetchOpenInterestHist(symbol, timeframe, {
      startTime: cursor,
      endTime: endMs,
      limit: OPEN_INTEREST_PAGE_LIMIT,
    });
    if (page.length === 0) break;
    out.push(...page);
    const last = page[page.length - 1] as OpenInterestPoint;
    const next = last.timestamp + stepMs;
    if (next <= cursor) break;
    cursor = next;
    if (page.length < OPEN_INTEREST_PAGE_LIMIT) break;
  }

  return out;
}

/**
 * Latest point at or before `atMs`, using a forward-only cursor.
 *
 * Forward-only is what keeps the replay honest: the cursor can never move
 * back, so no candle can be scored with a value that was only published
 * later. `points` must be sorted ascending.
 */
class StepHoldCursor<T> {
  private index = -1;

  constructor(
    private readonly points: T[],
    private readonly timeOf: (point: T) => number,
  ) {}

  advanceTo(atMs: number): { current: T | undefined; previous: T | undefined } {
    while (this.index + 1 < this.points.length && this.timeOf(this.points[this.index + 1] as T) <= atMs) {
      this.index += 1;
    }
    return {
      current: this.index >= 0 ? this.points[this.index] : undefined,
      previous: this.index >= 1 ? this.points[this.index - 1] : undefined,
    };
  }
}

/**
 * Stores futures 5m candles for `symbol` over the window, for pricing only.
 *
 * Deliberately not a scored window: it writes no signals, computes no
 * snapshot, advances no state. An operator who left 5m out of TIMEFRAMES
 * does not want 5m signals — they want the timeframes they trade. But
 * without these candles every outcome, replayed and live alike, stays
 * pending forever: `getResolvableOutcomes` prices at the first futures 5m
 * candle at or after signal time + horizon, and a row with no such candle
 * is never returned. That is a backlog that grows and never drains, and it
 * looks exactly like "the tracker is behind".
 */
async function backfillPricingCandles(
  deps: BackfillDeps,
  symbol: SymbolId,
  startMs: number,
  endMs: number,
): Promise<number> {
  const candles = await fetchKlineRange(
    (s, tf, o) => deps.futuresAdapter.fetchKlines(s, tf, o),
    symbol,
    PRICING_TIMEFRAME,
    startMs,
    endMs,
  );
  for (const candle of candles) await upsertCandle(deps.pool, candle, 'backfill');
  return candles.length;
}

/** Replays one (symbol, timeframe) over `[startMs, endMs)`, writing rows tagged source='backfill'. */
export async function backfillWindow(
  deps: BackfillDeps,
  symbol: SymbolId,
  timeframe: Timeframe,
  startMs: number,
  endMs: number,
): Promise<BackfillWindowReport> {
  const stepMs = timeframeToMs(timeframe);
  const warmupStartMs = startMs - WARMUP_CANDLES * stepMs;
  const futuresOnly = deps.futuresOnlySymbolSet.has(symbol);

  const report: BackfillWindowReport = {
    symbol,
    timeframe,
    futuresCandles: 0,
    spotCandles: 0,
    openInterestPoints: 0,
    fundingPoints: 0,
    warmupCandles: 0,
    evaluatedCandles: 0,
    signalsWritten: 0,
    unpairedCandles: 0,
    missingOpenInterest: 0,
  };

  const futuresCandles = await fetchKlineRange(
    (s, tf, o) => deps.futuresAdapter.fetchKlines(s, tf, o),
    symbol,
    timeframe,
    warmupStartMs,
    endMs,
  );
  report.futuresCandles = futuresCandles.length;
  if (futuresCandles.length === 0) return report;

  const spotCandles = futuresOnly
    ? []
    : await fetchKlineRange((s, tf, o) => deps.spotAdapter.fetchKlines(s, tf, o), symbol, timeframe, warmupStartMs, endMs);
  report.spotCandles = spotCandles.length;
  const spotByOpenTime = new Map(spotCandles.map((c) => [c.openTime, c]));

  // Open interest is only fetched for the scored window: warm-up candles
  // never produce a snapshot, and the 30-day ceiling is scarce enough not
  // to spend requests on candles that will be discarded.
  const openInterestPoints = await fetchOpenInterestRange(deps, symbol, timeframe, startMs - stepMs, endMs);
  report.openInterestPoints = openInterestPoints.length;

  const fundingPoints = await deps.futuresAdapter.fetchFundingRateHistory(symbol, {
    startTime: warmupStartMs,
    endTime: endMs,
    limit: 1000,
  });
  report.fundingPoints = fundingPoints.length;

  for (const point of openInterestPoints) await insertOpenInterest(deps.pool, point);
  for (const point of fundingPoints) await insertFundingRate(deps.pool, point);

  const oiCursor = new StepHoldCursor(openInterestPoints, (p) => p.timestamp);
  const fundingCursor = new StepHoldCursor(fundingPoints, (p) => p.fundingTime);

  // Rolling state, rebuilt exactly as SymbolTimeframeState maintains it live.
  let spotCumulativeCvd = 0;
  let futuresCumulativeCvd = 0;
  const spotVolumeHistory: number[] = [];
  const futuresVolumeHistory: number[] = [];
  const recentTrueRanges: number[] = [];
  let previousFuturesClose: number | undefined;

  const pushVolume = (history: number[], volume: number): void => {
    history.push(volume);
    if (history.length > WARMUP_CANDLES) history.shift();
  };

  for (const futuresCandle of futuresCandles) {
    const spotCandle = spotByOpenTime.get(futuresCandle.openTime);
    const isWarmup = futuresCandle.openTime < startMs;

    if (!futuresOnly && !spotCandle) {
      // No spot counterpart: state must not advance either, or the CVD and
      // volume series would silently diverge from what a live run saw.
      if (!isWarmup) report.unpairedCandles += 1;
      continue;
    }

    if (isWarmup) {
      report.warmupCandles += 1;
      futuresCumulativeCvd += futuresCandle.takerBuyBaseVolume - futuresCandle.takerSellBaseVolume;
      pushVolume(futuresVolumeHistory, futuresCandle.volume);
      if (spotCandle) {
        spotCumulativeCvd += spotCandle.takerBuyBaseVolume - spotCandle.takerSellBaseVolume;
        pushVolume(spotVolumeHistory, spotCandle.volume);
      }
      recentTrueRanges.push(computeTrueRange(futuresCandle, previousFuturesClose));
      if (recentTrueRanges.length > 14) recentTrueRanges.shift();
      previousFuturesClose = futuresCandle.close;
      continue;
    }

    const { current: currentOI, previous: previousOI } = oiCursor.advanceTo(futuresCandle.closeTime);
    if (!currentOI) {
      // Every OI-reading rule is unevaluable without this, and substituting
      // a stale or zero value would put a fabricated number into the one
      // surface that exists to be honest about evidence.
      report.missingOpenInterest += 1;
      continue;
    }

    const { current: funding } = fundingCursor.advanceTo(futuresCandle.closeTime);

    const dataQuality = assessDataQuality(
      symbol,
      timeframe,
      {
        futuresWsHealthy: true,
        futuresGapCandles: 0,
        openInterestStale: false,
        fundingStale: funding === undefined,
        // Always false for a replay: there is no liquidation history to
        // build a baseline from. This is what makes a backfilled signal
        // score lower confidence than a live one, which is correct.
        liquidationBaselineReady: false,
        ...(futuresOnly ? {} : { spot: { wsHealthy: true, gapCandles: 0 } }),
      },
      futuresCandle.closeTime,
    );

    const shared = {
      symbol,
      timeframe,
      futuresCandle,
      previousFuturesCumulativeCvd: futuresCumulativeCvd,
      futuresVolumeHistory: [...futuresVolumeHistory],
      previousOpenInterest: previousOI,
      currentOpenInterest: currentOI,
      fundingRateFraction: funding?.fundingRate ?? 0,
      liquidationEventsInWindow: [],
      rollingLiquidation24hUsd: 0,
      previousFuturesClose,
      recentTrueRanges: [...recentTrueRanges],
      dataQuality,
      thresholds: deps.thresholds,
    };

    const snapshot: MarketSnapshot = spotCandle
      ? computeMarketSnapshot({
          ...shared,
          spotCandle,
          previousSpotCumulativeCvd: spotCumulativeCvd,
          spotVolumeHistory: [...spotVolumeHistory],
        })
      : computeFuturesOnlySnapshot(shared);

    const signals = evaluateSignals(snapshot, {
      thresholds: deps.thresholds,
      confidenceWeights: deps.confidenceWeights,
      getHistoricalScore: () => undefined,
    });

    const health = computeHealth(snapshot, signals, deps.thresholds, deps.healthWeights);
    const risk = computeRisk(snapshot, signals, deps.thresholds, deps.riskWeights);

    await upsertCandle(deps.pool, futuresCandle, 'backfill');
    if (spotCandle) await upsertCandle(deps.pool, spotCandle, 'backfill');
    if (snapshot.spot) await saveSpotMetrics(deps.pool, snapshot, 'backfill');
    await saveFuturesMetrics(deps.pool, snapshot, 'backfill');
    await saveHealthSnapshot(deps.pool, snapshot, health, risk, 'backfill');

    for (const signal of signals) {
      await writeBackfilledSignal(deps, signal, snapshot, health?.score ?? null, risk.score);
      report.signalsWritten += 1;
    }

    report.evaluatedCandles += 1;

    // State advances only after the candle has been scored, so nothing it
    // contributes can leak into its own snapshot.
    futuresCumulativeCvd = snapshot.futures.cvdCumulative;
    pushVolume(futuresVolumeHistory, futuresCandle.volume);
    if (snapshot.spot && spotCandle) {
      spotCumulativeCvd = snapshot.spot.cvdCumulative;
      pushVolume(spotVolumeHistory, spotCandle.volume);
    }
    recentTrueRanges.push(computeTrueRange(futuresCandle, previousFuturesClose));
    if (recentTrueRanges.length > 14) recentTrueRanges.shift();
    previousFuturesClose = futuresCandle.close;
  }

  return report;
}

async function writeBackfilledSignal(
  deps: BackfillDeps,
  signal: Signal,
  snapshot: MarketSnapshot,
  healthScore: number | null,
  riskScore: number,
): Promise<void> {
  await insertSignal(
    deps.pool,
    signal,
    {
      price: snapshot.price.close,
      healthScore,
      riskScore,
      spotCvd: snapshot.spot?.cvdCumulative ?? null,
      futuresCvd: snapshot.futures.cvdCumulative,
      openInterest: snapshot.futures.openInterest,
      fundingRate: snapshot.futures.fundingRate,
      volume: snapshot.futures.volume,
    },
    'backfill',
  );
}

export interface BackfillOptions {
  symbols: SymbolId[];
  timeframes: Timeframe[];
  /** How far back to replay. Capped at OPEN_INTEREST_HISTORY_DAYS, past which Binance serves no open interest and five of the nine rules become unevaluable. */
  days: number;
  /** Replay up to this instant. Defaults to now; overridable so a run is reproducible. */
  endMs?: number;
}

export interface BackfillSummary {
  windows: BackfillWindowReport[];
  totalSignals: number;
  totalEvaluated: number;
  /** Rules that cannot fire in a replay at all, listed so a zero count is never read as "this never happens". */
  unreplayableSignalTypes: string[];
  /** Windows that threw. Counted rather than only logged, so a caller can tell a partial run from a total one. */
  failedWindows: number;
  /** Futures 5m candles stored purely so outcomes can be priced. Zero when 5m was already a scored timeframe. */
  pricingCandles: number;
  requestedDays: number;
  effectiveDays: number;
}

/** LONG_LIQUIDATION and SHORT_LIQUIDATION both require a liquidation spike, and liquidation history does not exist upstream. */
export const UNREPLAYABLE_SIGNAL_TYPES = ['LONG_LIQUIDATION', 'SHORT_LIQUIDATION'] as const;

export async function runHistoryBackfill(deps: BackfillDeps, options: BackfillOptions): Promise<BackfillSummary> {
  const endMs = options.endMs ?? Date.now();
  const effectiveDays = Math.min(options.days, OPEN_INTEREST_HISTORY_DAYS);

  if (effectiveDays < options.days) {
    deps.logger.warn(
      { requestedDays: options.days, effectiveDays },
      'backfill window truncated — Binance serves open interest for the last 30 days only',
    );
  }

  const startMs = endMs - effectiveDays * DAY_MS;
  const windows: BackfillWindowReport[] = [];
  let failedWindows = 0;

  for (const symbol of options.symbols) {
    for (const timeframe of options.timeframes) {
      try {
        const report = await backfillWindow(deps, symbol, timeframe, startMs, endMs);
        windows.push(report);
        deps.logger.info(report, 'backfill window complete');
      } catch (err) {
        // One symbol/timeframe failing upstream must not discard the
        // windows that already succeeded — each is independently useful.
        failedWindows += 1;
        deps.logger.error({ err, symbol, timeframe }, 'backfill window failed');
      }
    }
  }

  // Unconditional on the windows above having produced anything: these
  // candles also price the *live* signals already sitting pending, which
  // is the backlog an operator actually notices on the status page.
  let pricingCandles = 0;
  if (!options.timeframes.includes(PRICING_TIMEFRAME)) {
    for (const symbol of options.symbols) {
      try {
        pricingCandles += await backfillPricingCandles(deps, symbol, startMs, endMs);
      } catch (err) {
        deps.logger.error(
          { err, symbol },
          'pricing-candle fetch failed — outcomes for this symbol cannot be scored',
        );
      }
    }
    deps.logger.info({ pricingCandles, timeframe: PRICING_TIMEFRAME }, 'pricing candles stored');
  }

  return {
    windows,
    totalSignals: windows.reduce((sum, w) => sum + w.signalsWritten, 0),
    totalEvaluated: windows.reduce((sum, w) => sum + w.evaluatedCandles, 0),
    unreplayableSignalTypes: [...UNREPLAYABLE_SIGNAL_TYPES],
    failedWindows,
    pricingCandles,
    requestedDays: options.days,
    effectiveDays,
  };
}

/**
 * Fills price_after_* for the signals this replay just wrote.
 *
 * The live tracker would get there eventually (200 rows per horizon every
 * five minutes), but a replay writes its whole backlog at once, so draining
 * it here turns /performance usable at the end of the run instead of hours
 * later. Same rule as the live path — the price is read at the candle
 * covering signal time + horizon, never at whatever candle is newest.
 */
export async function resolveBackfilledOutcomes(
  deps: Pick<BackfillDeps, 'pool' | 'logger'>,
  nowMs: number = Date.now(),
): Promise<{ resolved: number; unresolved: number }> {
  const horizons: OutcomeHorizon[] = ['15m', '1h', '4h', '24h'];

  let resolved = 0;

  for (const horizon of horizons) {
    // Drains rather than taking one page: a replay writes its whole
    // backlog at once, and that is the point of running this. The query
    // only returns rows it can actually price, so this terminates — rows
    // with no candle to price against are simply never returned, and are
    // counted separately below rather than looped over forever.
    for (;;) {
      const batch = await getResolvableOutcomes(deps.pool, horizon, nowMs, 500, 'backfill');
      if (batch.length === 0) break;
      for (const row of batch) {
        await recordOutcomePrice(deps.pool, row.signalId, horizon, row.closeAtHorizon, row.priceAtSignal);
        resolved += 1;
      }
    }
  }

  let unresolved = 0;
  for (const horizon of horizons) {
    unresolved += await countPendingOutcomes(deps.pool, horizon, nowMs, 'backfill');
  }

  if (unresolved > 0) {
    // Expected for signals younger than their horizon — 24h outcomes for
    // the last day of the window genuinely cannot exist yet. Anything
    // beyond that means futures 5m candles are missing for the period,
    // which `backfillPricingCandles` above is what stores.
    deps.logger.warn(
      { resolved, unresolved, pricedFrom: PRICING_TIMEFRAME },
      'some replayed signals have no futures 5m candle to price against',
    );
  } else {
    deps.logger.info({ resolved, unresolved }, 'backfilled outcomes resolved');
  }

  return { resolved, unresolved };
}
