import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase } from './testPool.js';
import { getSignalVerdicts, saveSignalVerdicts, type SignalVerdict } from './verdicts.js';
import {
  ROUND_TRIP_COST_PCT,
  countPendingOutcomes,
  getBaselinePerformance,
  getResolvableOutcomes,
  getSignalPerformance,
  getStuckOutcomeCensus,
} from './outcomes.js';

/**
 * These run against real Postgres because they are testing SQL, and a fake
 * pool would only test that the string was assembled — which is never what
 * went wrong here.
 */
describe.skipIf(!hasTestDatabase)('outcome queries against real Postgres', () => {
  let pool: Pool;
  const NOW = Date.parse('2026-09-02T12:00:00Z');
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function signal(ts: number, source = 'backfill'): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO market_signals
         (symbol, timeframe, signal_type, severity, confidence, timestamp, reasons, metrics,
          price, risk_score, futures_cvd, open_interest, funding_rate, volume, source)
       VALUES ('BTCUSDT','15m','CVD_DIVERGENCE','MEDIUM',0.6,$1,'[]'::jsonb,'{}'::jsonb,
               100,10,0,0,0,0,$2) RETURNING signal_id`,
      [iso(ts), source],
    );
    const id = rows[0].signal_id as string;
    await pool.query(`INSERT INTO signal_outcomes (signal_id, price_at_signal) VALUES ($1, 100)`, [id]);
    return id;
  }

  async function candle(openMs: number, close = 110): Promise<void> {
    await pool.query(
      `INSERT INTO market_candles
         (symbol, market, timeframe, open_time, close_time, open, high, low, close, volume,
          quote_volume, trades, taker_buy_base_volume, taker_buy_quote_volume, taker_sell_base_volume, source)
       VALUES ('BTCUSDT','futures','5m',$1,$2,100,111,99,$3,10,1000,5,5,500,5,'backfill')
       ON CONFLICT DO NOTHING`,
      [iso(openMs), iso(openMs + 299_999), close],
    );
  }

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('DELETE FROM signal_outcomes');
    await pool.query('DELETE FROM market_signals');
    await pool.query('DELETE FROM market_candles');

    // Candle coverage starts 10 days ago.
    for (let i = 0; i < 12; i += 1) await candle(NOW - 10 * DAY + i * 300_000);

    // Priceable: inside coverage, with candles across its 15m window. The
    // one at exactly +15m carries a distinct close so the assertion below
    // proves the query took the FIRST candle at or after the horizon,
    // rather than merely some candle in range.
    const priceable = NOW - 10 * DAY;
    await signal(priceable);
    await pool.query(
      `UPDATE market_candles SET close = 123
       WHERE symbol = 'BTCUSDT' AND market = 'futures' AND timeframe = '5m' AND open_time = $1`,
      [iso(priceable + 15 * 60_000)],
    );

    // Inside coverage, no candle anywhere near its window: a real gap.
    await signal(NOW - 5 * DAY);
    // Older than every candle: permanently unpriceable.
    await signal(NOW - 20 * DAY);
    await signal(NOW - 25 * DAY);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns only rows a candle can actually price', async () => {
    // The bug this replaced returned rows it could not price, and since it
    // ordered oldest-first under a LIMIT, those dead rows blocked the queue
    // permanently while the job logged a healthy "200 pending" every pass.
    const rows = await getResolvableOutcomes(pool, '15m', NOW, 200);
    expect(rows).toHaveLength(1);
    // 123 is the candle at exactly +15m. Any later candle in the window
    // would price the outcome at a different moment than the horizon.
    expect(rows[0]?.closeAtHorizon).toBe(123);
    expect(rows[0]?.priceAtSignal).toBe(100);
  });

  it('counts what is waiting separately from what is workable', async () => {
    // Filtering unpriceable rows out of the work queue must not also hide
    // that they exist.
    expect(await countPendingOutcomes(pool, '15m', NOW)).toBe(4);
  });

  it('splits the backlog into causes that sum to the total', async () => {
    const c = await getStuckOutcomeCensus(pool, '15m', NOW);
    expect(c.pending).toBe(4);
    expect(c.withCandles).toBe(1);
    expect(c.predateCandles).toBe(2);
    expect(c.insideCoverageNoCandle).toBe(1);
    // A breakdown that loses rows is worse than no breakdown.
    expect(c.withCandles + c.predateCandles + c.insideCoverageNoCandle).toBe(c.pending);
  });

  it('filters by provenance when asked', async () => {
    await signal(NOW - 10 * DAY, 'live');
    expect(await getResolvableOutcomes(pool, '15m', NOW, 200, 'backfill')).toHaveLength(1);
    expect(await getResolvableOutcomes(pool, '15m', NOW, 200, 'live')).toHaveLength(1);
  });
});

/**
 * The cost floor against real SQL.
 *
 * In this file rather than its own because vitest runs separate files in
 * parallel and these share one database: a suite that truncates
 * `signal_outcomes` mid-run makes the suite above count the wrong number
 * of pending rows, intermittently. Suites inside a file run in order.
 *
 * The signal side is arithmetic in JS and would survive a fake pool. The
 * baseline side is a `count(*) FILTER` inside a lateral join with a
 * positional parameter, which is exactly the shape that breaks silently:
 * a flipped sign counts the wrong direction and still returns a plausible
 * percentage. Nothing about the number would look wrong on the page.
 */
describe.skipIf(!hasTestDatabase)('cost-adjusted performance against real Postgres', () => {
  let pool: Pool;
  const NOW = Date.parse('2026-09-02T12:00:00Z');
  const START = NOW - 6 * 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  async function outcome(movePct: number, atMs = START + 60_000): Promise<void> {
    const { rows } = await pool.query(
      `INSERT INTO market_signals
         (symbol, timeframe, signal_type, severity, confidence, timestamp, reasons, metrics,
          price, risk_score, futures_cvd, open_interest, funding_rate, volume, source)
       VALUES ('BTCUSDT','15m','LONG_CROWDING','MEDIUM',0.6,$1,'[]'::jsonb,'{}'::jsonb,
               100,10,0,0,0,0,'backfill') RETURNING signal_id`,
      [iso(atMs)],
    );
    await pool.query(
      `INSERT INTO signal_outcomes (signal_id, price_at_signal, move_after_15m_pct) VALUES ($1, 100, $2)`,
      [rows[0].signal_id, movePct],
    );
  }

  async function candles(closeAt: (i: number) => number, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const openMs = START + i * 300_000;
      await pool.query(
        `INSERT INTO market_candles
           (symbol, market, timeframe, open_time, close_time, open, high, low, close, volume,
            quote_volume, trades, taker_buy_base_volume, taker_buy_quote_volume, taker_sell_base_volume, source)
         VALUES ('BTCUSDT','futures','5m',$1,$2,100,111,99,$3,10,1000,5,5,500,5,'backfill')
         ON CONFLICT DO NOTHING`,
        [iso(openMs), iso(openMs + 299_999), closeAt(i)],
      );
    }
  }

  beforeAll(async () => {
    pool = createTestPool();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM signal_outcomes');
    await pool.query('DELETE FROM market_signals');
    await pool.query('DELETE FROM market_candles');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('separates "went the right way" from "went far enough to pay for itself"', async () => {
    // Ten each of: barely up, clearly up, barely down, clearly down. The
    // raw rates say a coin flip; the net rates say half those flips were
    // won and still lost money.
    for (let i = 0; i < 10; i += 1) {
      await outcome(0.05); // under the 0,1% floor
      await outcome(0.5);
      await outcome(-0.05);
      await outcome(-0.5);
    }

    const perf = await getSignalPerformance(pool, 'LONG_CROWDING', '15m');
    expect(perf.sampleCount).toBe(40);
    expect(perf.positiveMovePct).toBe(50);
    expect(perf.negativeMovePct).toBe(50);
    expect(perf.netPositiveMovePct).toBe(25);
    expect(perf.netNegativeMovePct).toBe(25);
    expect(perf.costPct).toBe(ROUND_TRIP_COST_PCT);
  });

  it('does not count a move exactly at the cost floor as paying for itself', async () => {
    // Break-even is not a win: fees are paid on both sides of it.
    for (let i = 0; i < 5; i += 1) {
      await outcome(ROUND_TRIP_COST_PCT);
      await outcome(-ROUND_TRIP_COST_PCT);
    }
    const perf = await getSignalPerformance(pool, 'LONG_CROWDING', '15m');
    expect(perf.positiveMovePct).toBe(50);
    expect(perf.netPositiveMovePct).toBe(0);
    expect(perf.netNegativeMovePct).toBe(0);
  });

  it('applies the same floor to the baseline, in both directions', async () => {
    // The baseline measures the window the recorded outcomes span, so it
    // needs two of them to have a window at all.
    await outcome(0.5);
    await outcome(0.5, START + 5 * 3_600_000);

    // Every 15m move here is ±0,01% — real direction, nowhere near the
    // cost of trading it. A sign flip in the SQL would light one of the
    // net figures up at ~100%.
    await candles((i) => 100 + [0, 0.01, 0.02, 0.01][i % 4]!, 24);

    const base = await getBaselinePerformance(pool, '15m');
    expect(base.sampleCount).toBeGreaterThan(0);
    expect(base.positiveMovePct as number).toBeGreaterThan(0);
    expect(base.netPositiveMovePct).toBe(0);
    expect(base.netNegativeMovePct).toBe(0);
    expect(base.costPct).toBe(ROUND_TRIP_COST_PCT);
  });

  it('does count baseline moves that clear the floor', async () => {
    await outcome(0.5);
    await outcome(0.5, START + 5 * 3_600_000);

    // A steady climb of 1% per 5m candle: every 15m window clears 0,1%
    // comfortably, so the up-side net rate must be total and the down-side
    // zero. Pairs with the test above — together they pin the sign.
    await candles((i) => 100 * 1.01 ** i, 24);

    const base = await getBaselinePerformance(pool, '15m');
    expect(base.netPositiveMovePct).toBe(100);
    expect(base.netNegativeMovePct).toBe(0);
  });
});

/**
 * The verdict cache round-trip.
 *
 * The read and the write are trivial on their own; what is not trivial is
 * that the write *replaces* rather than merges. A type that has dropped
 * below the sample threshold must lose its verdict, because a stale
 * "worse than doing nothing" badge on a type nobody is measuring any more
 * is exactly the confident-and-wrong this project spends its effort
 * avoiding — and a merging upsert would leave it there forever.
 */
describe.skipIf(!hasTestDatabase)('signal verdict cache against real Postgres', () => {
  let pool: Pool;

  function verdict(signalType: string, overrides: Partial<SignalVerdict> = {}): SignalVerdict {
    return {
      signalType,
      horizon: '4h',
      source: 'all',
      verdict: 'worse',
      deltaPp: -3,
      marginPp: 1.4,
      sampleCount: 10_655,
      hitPct: 51,
      baselinePct: 54,
      baselineSampleCount: 35_547,
      comparisons: 5,
      computedAt: Date.parse('2026-09-02T12:00:00Z'),
      ...overrides,
    };
  }

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('DELETE FROM signal_verdicts');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('round-trips every field, numerics included', async () => {
    await saveSignalVerdicts(pool, [verdict('SELLING_ABSORPTION_POSSIBLE')]);
    const [row] = await getSignalVerdicts(pool);
    expect(row).toEqual(verdict('SELLING_ABSORPTION_POSSIBLE'));
  });

  it('drops a type that no longer has a verdict instead of keeping the last one', async () => {
    await saveSignalVerdicts(pool, [verdict('A'), verdict('B')]);
    await saveSignalVerdicts(pool, [verdict('A')]);
    expect((await getSignalVerdicts(pool)).map((v) => v.signalType)).toEqual(['A']);
  });

  it('clears everything when nothing is conclusive any more', async () => {
    await saveSignalVerdicts(pool, [verdict('A')]);
    await saveSignalVerdicts(pool, []);
    expect(await getSignalVerdicts(pool)).toEqual([]);
  });

  it('keeps a null margin null rather than turning it into zero', async () => {
    // Zero would read as "no uncertainty at all", the strongest possible
    // claim, from the case where the comparison could not be made.
    await saveSignalVerdicts(pool, [verdict('A', { marginPp: null })]);
    expect((await getSignalVerdicts(pool))[0]?.marginPp).toBeNull();
  });
});
