import { describe, expect, it, vi } from 'vitest';
import type { Candle, FundingRatePoint, OpenInterestPoint, SymbolId, Timeframe } from '@crypto-signal/shared';
import { loadConfig, resetConfigCache, timeframeToMs } from '@crypto-signal/shared';
import { backfillWindow, runHistoryBackfill, type BackfillDeps } from './historyBackfill.js';

/**
 * These tests exist for one reason: a backtest that peeks at the future
 * reports an edge that does not exist, and it does so silently. Everything
 * below is aimed at that failure mode rather than at happy-path plumbing.
 */

const TF: Timeframe = '5m';
const STEP = timeframeToMs(TF);
const SYMBOL = 'BTCUSDT' as SymbolId;

function candle(openTime: number, close: number, opts: Partial<Candle> = {}): Candle {
  const volume = opts.volume ?? 100;
  const takerBuy = opts.takerBuyBaseVolume ?? volume * 0.5;
  return {
    symbol: SYMBOL,
    market: 'futures',
    timeframe: TF,
    openTime,
    closeTime: openTime + STEP - 1,
    open: opts.open ?? close,
    high: opts.high ?? close,
    low: opts.low ?? close,
    close,
    volume,
    quoteVolume: volume * close,
    trades: 10,
    takerBuyBaseVolume: takerBuy,
    takerBuyQuoteVolume: takerBuy * close,
    takerSellBaseVolume: volume - takerBuy,
    ...opts,
  } as Candle;
}

interface Recorded {
  candles: Array<{ openTime: number; source: string }>;
  futuresMetrics: Array<{ timestamp: number; source: string }>;
  signals: Array<{ timestamp: number; signalType: string; source: string }>;
}

function buildDeps(
  futuresCandles: Candle[],
  spotCandles: Candle[],
  oiPoints: OpenInterestPoint[],
  fundingPoints: FundingRatePoint[],
  recorded: Recorded,
): BackfillDeps {
  resetConfigCache();
  const config = loadConfig({} as NodeJS.ProcessEnv);

  const pool = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      if (text.includes('INSERT INTO market_candles')) {
        recorded.candles.push({ openTime: Number(params[3]), source: String(params[15]) });
      } else if (text.includes('INSERT INTO futures_metrics')) {
        recorded.futuresMetrics.push({ timestamp: Number(params[2]), source: String(params[19]) });
      } else if (text.includes('INSERT INTO market_signals')) {
        recorded.signals.push({ timestamp: Number(params[5]), signalType: String(params[2]), source: String(params[16]) });
        return { rows: [{ signal_id: `sig-${recorded.signals.length}` }] };
      }
      return { rows: [] };
    }),
  } as unknown as BackfillDeps['pool'];

  const sliceByTime = <T extends { openTime: number }>(all: T[], opts: { startTime?: number; endTime?: number; limit?: number }): T[] => {
    const from = opts.startTime ?? -Infinity;
    const to = opts.endTime ?? Infinity;
    return all.filter((c) => c.openTime >= from && c.openTime <= to).slice(0, opts.limit ?? 1000);
  };

  return {
    pool,
    spotAdapter: { fetchKlines: async (_s, _tf, o) => sliceByTime(spotCandles, o) },
    futuresAdapter: {
      fetchKlines: async (_s, _tf, o) => sliceByTime(futuresCandles, o),
      fetchOpenInterestHist: async (_s, _tf, o) => {
        const from = o.startTime ?? -Infinity;
        const to = o.endTime ?? Infinity;
        return oiPoints.filter((p) => p.timestamp >= from && p.timestamp <= to).slice(0, o.limit ?? 500);
      },
      fetchFundingRateHistory: async () => fundingPoints,
    },
    thresholds: config.thresholds,
    healthWeights: config.healthWeights,
    riskWeights: config.riskWeights,
    confidenceWeights: config.confidenceWeights,
    futuresOnlySymbolSet: new Set([SYMBOL]),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function emptyRecorded(): Recorded {
  return { candles: [], futuresMetrics: [], signals: [] };
}

describe('backfillWindow', () => {
  const base = 1_700_000_000_000;
  const warmup = 96;
  const scored = 20;
  const total = warmup + scored;

  const futures = Array.from({ length: total }, (_, i) => candle(base + i * STEP, 100 + i * 0.01));
  const oi = Array.from({ length: total }, (_, i) => ({
    symbol: SYMBOL,
    timeframe: TF,
    timestamp: base + i * STEP,
    sumOpenInterest: 1000 + i,
    sumOpenInterestValue: (1000 + i) * 100,
  })) as OpenInterestPoint[];
  const funding: FundingRatePoint[] = [{ symbol: SYMBOL, fundingTime: base, fundingRate: 0.0001, markPrice: 100 }];

  const windowStart = base + warmup * STEP;
  const windowEnd = base + total * STEP;

  it('never scores a candle before the rolling windows are as deep as a live run', async () => {
    const recorded = emptyRecorded();
    const deps = buildDeps(futures, [], oi, funding, recorded);

    const report = await backfillWindow(deps, SYMBOL, TF, windowStart, windowEnd);

    expect(report.warmupCandles).toBe(warmup);
    expect(report.evaluatedCandles).toBe(scored);
    // Nothing at all is written for a warm-up candle — not a metric row, not a signal.
    expect(recorded.futuresMetrics.every((m) => m.timestamp >= windowStart)).toBe(true);
  });

  it('tags every written row as backfill so it can never be mistaken for an observation', async () => {
    const recorded = emptyRecorded();
    const deps = buildDeps(futures, [], oi, funding, recorded);

    await backfillWindow(deps, SYMBOL, TF, windowStart, windowEnd);

    expect(recorded.candles.length).toBeGreaterThan(0);
    expect(recorded.candles.every((c) => c.source === 'backfill')).toBe(true);
    expect(recorded.futuresMetrics.every((m) => m.source === 'backfill')).toBe(true);
    expect(recorded.signals.every((s) => s.source === 'backfill')).toBe(true);
  });

  it('writes NULL rather than 0 for liquidation figures it cannot know', async () => {
    const recorded = emptyRecorded();
    const deps = buildDeps(futures, [], oi, funding, recorded);
    await backfillWindow(deps, SYMBOL, TF, windowStart, windowEnd);

    const call = (deps.pool.query as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('INSERT INTO futures_metrics'),
    );
    expect(call).toBeDefined();
    const params = call![1] as unknown[];
    // liquidation_long_usd, liquidation_short_usd, liquidation_anomaly_ratio
    expect(params[16]).toBeNull();
    expect(params[17]).toBeNull();
    expect(params[18]).toBeNull();
  });

  it('skips a candle whose open interest is not yet published instead of reusing a stale value', async () => {
    const recorded = emptyRecorded();
    // OI stops halfway through the scored window.
    const truncatedOi = oi.filter((p) => p.timestamp < windowStart + 10 * STEP);
    const deps = buildDeps(futures, [], truncatedOi, funding, recorded);

    const report = await backfillWindow(deps, SYMBOL, TF, windowStart, windowEnd);

    // The cursor holds the last known point rather than inventing one, so
    // candles past the end still resolve — what must never happen is a
    // candle scored with an OI point published *after* it.
    expect(report.evaluatedCandles + report.missingOpenInterest).toBe(scored);
  });

  it('never uses an open-interest point published after the candle it scores', async () => {
    const recorded = emptyRecorded();
    // A single OI point, sitting inside the fetched range but partway
    // through the window. Candles before it have no published OI yet and
    // must be skipped; only candles at or after it may be scored.
    //
    // This is the shape that catches a look-ahead bug. An earlier version
    // of this test put the point *past* the window end, where the fetch
    // range filtered it out before the cursor ever saw it — so it passed
    // even with the ordering check removed.
    const oiAt = windowStart + 15 * STEP;
    const midWindowOi = [
      { symbol: SYMBOL, timeframe: TF, timestamp: oiAt, sumOpenInterest: 1234, sumOpenInterestValue: 123_400 },
    ] as OpenInterestPoint[];
    const deps = buildDeps(futures, [], midWindowOi, funding, recorded);

    const report = await backfillWindow(deps, SYMBOL, TF, windowStart, windowEnd);

    expect(report.missingOpenInterest).toBe(15);
    expect(report.evaluatedCandles).toBe(scored - 15);
    // Every metric row written must be at or after the OI point's time.
    expect(recorded.futuresMetrics.every((m) => m.timestamp >= oiAt)).toBe(true);
  });

  it('produces identical output when re-run over the same window', async () => {
    const first = emptyRecorded();
    await backfillWindow(buildDeps(futures, [], oi, funding, first), SYMBOL, TF, windowStart, windowEnd);
    const second = emptyRecorded();
    await backfillWindow(buildDeps(futures, [], oi, funding, second), SYMBOL, TF, windowStart, windowEnd);

    expect(second.signals).toEqual(first.signals);
    expect(second.futuresMetrics).toEqual(first.futuresMetrics);
  });
});

/**
 * The failure these cover was live for weeks and looked like a slow
 * tracker: 244 signals pending on every horizon, 0 resolvable, forever.
 * TIMEFRAMES was set to 15m,1h,4h — sensible for analysis, fatal for
 * scoring, because outcomes are priced off futures 5m candles and nothing
 * was storing any.
 */
describe('runHistoryBackfill — pricing candles', () => {
  const base = 1_700_000_000_000;

  function pricingDeps(
    recorded: Recorded,
    opts: { fiveMinuteCandles?: Candle[]; throwOn5m?: boolean } = {},
  ): { deps: BackfillDeps; requested: Timeframe[] } {
    const requested: Timeframe[] = [];
    const deps = buildDeps([], [], [], [], recorded);
    const fiveMin = opts.fiveMinuteCandles ?? [];

    deps.futuresAdapter = {
      ...deps.futuresAdapter,
      fetchKlines: async (_s, tf, o) => {
        requested.push(tf);
        if (tf !== '5m') return [];
        if (opts.throwOn5m) throw new Error('binance said no');
        const from = o.startTime ?? -Infinity;
        const page = fiveMin.filter((c) => c.openTime >= from).slice(0, o.limit ?? 1000);
        return page;
      },
    };
    return { deps, requested };
  }

  it('stores futures 5m candles when 5m is not a scored timeframe', async () => {
    const recorded = emptyRecorded();
    const fiveMin = Array.from({ length: 3 }, (_, i) => candle(base + i * STEP, 100 + i));
    const { deps, requested } = pricingDeps(recorded, { fiveMinuteCandles: fiveMin });

    const summary = await runHistoryBackfill(deps, {
      symbols: [SYMBOL],
      timeframes: ['1h'],
      days: 1,
      endMs: base + 10 * STEP,
    });

    expect(requested).toContain('5m');
    expect(summary.pricingCandles).toBe(3);
    // The fetch is not the point — the rows landing in market_candles is.
    // Without these, getResolvableOutcomes returns nothing, forever.
    expect(recorded.candles.map((c) => c.openTime)).toEqual(fiveMin.map((c) => c.openTime));
    expect(recorded.candles.every((c) => c.source === 'backfill')).toBe(true);
  });

  it('writes no signals for the pricing timeframe', async () => {
    // An operator who left 5m out of TIMEFRAMES does not want 5m signals.
    // Fixing the pricing gap by scoring 5m too would fill /performance with
    // a timeframe they never trade.
    const recorded = emptyRecorded();
    const fiveMin = Array.from({ length: 200 }, (_, i) => candle(base + i * STEP, 100 + i * 0.01));
    const { deps } = pricingDeps(recorded, { fiveMinuteCandles: fiveMin });

    await runHistoryBackfill(deps, {
      symbols: [SYMBOL],
      timeframes: ['1h'],
      days: 1,
      endMs: base + 300 * STEP,
    });

    expect(recorded.signals).toEqual([]);
    expect(recorded.futuresMetrics).toEqual([]);
  });

  it('does not fetch 5m twice when it is already being scored', async () => {
    const recorded = emptyRecorded();
    const { deps, requested } = pricingDeps(recorded, { fiveMinuteCandles: [] });

    const summary = await runHistoryBackfill(deps, {
      symbols: [SYMBOL],
      timeframes: ['5m'],
      days: 1,
      endMs: base + 10 * STEP,
    });

    expect(summary.pricingCandles).toBe(0);
    expect(requested.filter((tf) => tf === '5m')).toHaveLength(1);
  });

  it('survives a pricing fetch that throws', async () => {
    // One symbol failing upstream must not discard the replay; it must also
    // not be reported as if the candles were stored.
    const recorded = emptyRecorded();
    const { deps } = pricingDeps(recorded, { throwOn5m: true });

    const summary = await runHistoryBackfill(deps, {
      symbols: [SYMBOL],
      timeframes: ['1h'],
      days: 1,
      endMs: base + 10 * STEP,
    });

    expect(summary.pricingCandles).toBe(0);
    expect(deps.logger.error).toHaveBeenCalled();
  });
});

/**
 * The bug these cover ran in production and produced no error at all: the
 * replay reported 6.720 candles evaluated and 5.086 outcomes it could not
 * price, because the candles it needed to price them with had been thrown
 * away by the scoring gates before ever being written.
 */
describe('backfillWindow — candles are stored even when they cannot be scored', () => {
  const base = 1_700_000_000_000;

  it('stores a candle whose open interest is missing, and scores nothing from it', async () => {
    // Binance serves far fewer open-interest points than there are 5m bars
    // in a 30-day window, so this is the ordinary case on 5m, not an edge.
    const recorded = emptyRecorded();
    const total = 96 + 10;
    const futures = Array.from({ length: total }, (_, i) => candle(base + i * STEP, 100 + i * 0.01));
    const deps = buildDeps(futures, [], [], [], recorded); // no OI points at all

    const report = await backfillWindow(deps, SYMBOL, TF, base + 96 * STEP, base + total * STEP);

    expect(report.evaluatedCandles).toBe(0);
    expect(report.missingOpenInterest).toBeGreaterThan(0);
    expect(report.signalsWritten).toBe(0);
    // The point of the fix: the prices survive even though nothing scored.
    expect(report.storedCandles).toBe(total);
    expect(recorded.candles).toHaveLength(total);
    expect(recorded.candles.every((c) => c.source === 'backfill')).toBe(true);
  });

  it('stores warm-up candles too', async () => {
    // A signal early in the window is priced off candles from before it,
    // which are exactly the warm-up bars.
    const recorded = emptyRecorded();
    const futures = Array.from({ length: 20 }, (_, i) => candle(base + i * STEP, 100 + i * 0.01));
    const deps = buildDeps(futures, [], [], [], recorded);

    // Whole range is warm-up: nothing is scored, everything is stored.
    const report = await backfillWindow(deps, SYMBOL, TF, base + 20 * STEP, base + 21 * STEP);

    expect(report.warmupCandles).toBe(20);
    expect(report.evaluatedCandles).toBe(0);
    expect(report.storedCandles).toBe(20);
  });

  it('never stores fewer candles than it evaluates', async () => {
    // The invariant the old code broke. Storage is a superset of scoring.
    const recorded = emptyRecorded();
    const total = 96 + 20;
    const futures = Array.from({ length: total }, (_, i) => candle(base + i * STEP, 100 + i * 0.01));
    const oi = Array.from({ length: total }, (_, i) => ({
      symbol: SYMBOL,
      timeframe: TF,
      timestamp: base + i * STEP,
      sumOpenInterest: 1000 + i,
      sumOpenInterestValue: (1000 + i) * 100,
    }));
    const deps = buildDeps(futures, [], oi, [], recorded);

    const report = await backfillWindow(deps, SYMBOL, TF, base + 96 * STEP, base + total * STEP);

    expect(report.evaluatedCandles).toBeGreaterThan(0);
    expect(report.storedCandles).toBeGreaterThanOrEqual(report.evaluatedCandles);
  });
});
