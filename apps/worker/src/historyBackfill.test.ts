import { describe, expect, it, vi } from 'vitest';
import type { Candle, FundingRatePoint, OpenInterestPoint, SymbolId, Timeframe } from '@crypto-signal/shared';
import { loadConfig, resetConfigCache, timeframeToMs } from '@crypto-signal/shared';
import { backfillWindow, type BackfillDeps } from './historyBackfill.js';

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
