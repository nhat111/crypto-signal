import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase } from './testPool.js';
import { countPendingOutcomes, getResolvableOutcomes, getStuckOutcomeCensus } from './outcomes.js';

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
