import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase } from './testPool.js';
import { ROUND_TRIP_COST_PCT, getBaselinePerformance, getSignalPerformance } from './outcomes.js';

/**
 * The cost floor against real SQL.
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
