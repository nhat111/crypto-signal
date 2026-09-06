import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getRecentSignals } from './signals.js';

/** Its own key: no other suite touches market_signals. */
const SIGNAL_TABLES_LOCK = 991_003;

/**
 * The timeframe filter against real Postgres.
 *
 * `= ANY($n)` with a JS array is exactly the kind of thing a fake pool
 * cannot check — it either binds as a Postgres array or it does not, and
 * the failure is either an error or, worse, an empty result that reads as
 * "no signals" on a bot that is meant to be listing them.
 */
describe.skipIf(!hasTestDatabase)('signal timeframe filtering against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  async function signal(symbol: string, timeframe: string, minutesAgo: number): Promise<void> {
    await pool.query(
      `INSERT INTO market_signals
         (symbol, timeframe, signal_type, severity, confidence, timestamp, reasons, metrics, price,
          risk_score, futures_cvd, open_interest, funding_rate, volume)
       VALUES ($1, $2, 'SPOT_CONFIRMED_RALLY', 'MEDIUM', 70, now() - ($3 || ' minutes')::interval,
               '[]'::jsonb, '{}'::jsonb, 100, 30, 0, 0, 0, 0)`,
      [symbol, timeframe, minutesAgo],
    );
  }

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, SIGNAL_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM market_signals WHERE symbol LIKE 'TF%'");
  });
  afterAll(async () => {
    await pool.query("DELETE FROM market_signals WHERE symbol LIKE 'TF%'");
    await releaseLock();
    await pool.end();
  });

  it('returns only the requested frames', async () => {
    await signal('TFA', '5m', 1);
    await signal('TFB', '1h', 2);
    await signal('TFC', '4h', 3);

    const rows = await getRecentSignals(pool, { timeframes: ['1h', '4h'], limit: 50 });
    expect(rows.map((r) => r.timeframe).sort()).toEqual(['1h', '4h']);
  });

  it('handles a single frame the same way', async () => {
    await signal('TFA', '5m', 1);
    await signal('TFB', '1h', 2);

    const rows = await getRecentSignals(pool, { timeframes: ['1h'], limit: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.timeframe).toBe('1h');
  });

  /**
   * The trap. A caller resolving a set can legitimately end up with none,
   * and `= ANY('{}')` matches nothing — an empty list must therefore mean
   * "no filter", not "no signals", or the bot would report a quiet market
   * that isn't.
   */
  it('treats an empty list as no filter, not as matching nothing', async () => {
    await signal('TFA', '5m', 1);
    await signal('TFB', '1h', 2);

    const rows = await getRecentSignals(pool, { timeframes: [], limit: 50 });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('is the same as omitting the filter entirely', async () => {
    await signal('TFA', '5m', 1);
    await signal('TFB', '1h', 2);

    const withEmpty = await getRecentSignals(pool, { timeframes: [], limit: 50 });
    const without = await getRecentSignals(pool, { limit: 50 });
    expect(withEmpty.map((r) => r.symbol)).toEqual(without.map((r) => r.symbol));
  });

  it('returns nothing for a frame that has no signals, without erroring', async () => {
    await signal('TFA', '5m', 1);
    expect(await getRecentSignals(pool, { timeframes: ['4h'], limit: 50 })).toEqual([]);
  });

  it('still combines with the other filters', async () => {
    await signal('TFA', '1h', 1);
    await signal('TFB', '1h', 2);

    const rows = await getRecentSignals(pool, { symbol: 'TFA', timeframes: ['1h'], limit: 50 });
    expect(rows.map((r) => r.symbol)).toEqual(['TFA']);
  });

  it('keeps newest-first ordering across the filtered frames', async () => {
    await signal('TFOLD', '4h', 90);
    await signal('TFNEW', '1h', 1);

    const rows = await getRecentSignals(pool, { timeframes: ['1h', '4h'], limit: 50 });
    expect(rows.map((r) => r.symbol)).toEqual(['TFNEW', 'TFOLD']);
  });
});
