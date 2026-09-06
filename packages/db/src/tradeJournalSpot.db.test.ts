import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getOpenTradeForSymbol, getTrades, insertTrade, updateTrade } from './tradeJournal.js';

/** Its own key: no other suite touches trade_journal. */
const TRADE_TABLES_LOCK = 991_002;

/**
 * Spot trades against real Postgres.
 *
 * The side is a CHECK constraint, so "does 'spot' insert at all" is a
 * question only the database can answer — a fake pool would accept
 * anything and the failure would land in production on the first spot buy
 * somebody logged. The symbol round-trip is here for the same reason: what
 * matters is what comes back out of the column.
 */
describe.skipIf(!hasTestDatabase)('spot trades against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, TRADE_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM trade_journal WHERE chat_id = 'test-spot'");
  });
  afterAll(async () => {
    await pool.query("DELETE FROM trade_journal WHERE chat_id = 'test-spot'");
    await releaseLock();
    await pool.end();
  });

  const open = (symbol: string, side: 'spot' | 'long' | 'short' = 'spot', entryPrice = 100) =>
    insertTrade(pool, { chatId: 'test-spot', symbol, side, entryPrice, size: 2, note: null });

  it('accepts spot, which the old CHECK constraint would have rejected', async () => {
    const trade = await open('PONS');
    expect(trade.side).toBe('spot');
    expect(trade.status).toBe('open');
  });

  it('prices a closed spot buy as a gain when price rose', async () => {
    const trade = await open('PONS', 'spot', 100);
    const closed = await updateTrade(pool, trade.id, { exitPrice: 130 });
    expect(closed?.status).toBe('closed');
    expect(closed?.pnlPct).toBeCloseTo(30, 5);
    expect(closed?.pnlUsd).toBeCloseTo(60, 5);
  });

  it('stores a Solana address exactly as typed', async () => {
    // The whole reason normalizeTradeSymbol exists. Upper-casing base58
    // yields a different address, so the journal would name a token that
    // was never bought.
    const address = 'bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub';
    const trade = await open(address);
    expect(trade.symbol).toBe(address);

    const [readBack] = await getTrades(pool, { chatId: 'test-spot' });
    expect(readBack?.symbol).toBe(address);
  });

  it('folds a ticker so a lowercase /close finds the position', async () => {
    await open('btcusdt', 'spot', 78_000);

    const found = await getOpenTradeForSymbol(pool, 'test-spot', 'BTCUSDT');
    expect(found?.entryPrice).toBe(78_000);

    // And the other direction: stored upper, asked for lower.
    const alsoFound = await getOpenTradeForSymbol(pool, 'test-spot', 'btcusdt');
    expect(alsoFound?.id).toBe(found?.id);
  });

  it('finds an address-keyed position without mangling the lookup', async () => {
    const address = 'bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub';
    await open(address);

    expect(await getOpenTradeForSymbol(pool, 'test-spot', address)).toBeDefined();
    // The upper-cased form is a different token and must NOT match.
    expect(await getOpenTradeForSymbol(pool, 'test-spot', address.toUpperCase())).toBeUndefined();
  });

  it('leaves long and short working exactly as before', async () => {
    const short = await open('ETHUSDT', 'short', 4_000);
    const closed = await updateTrade(pool, short.id, { exitPrice: 3_600 });
    expect(closed?.pnlPct).toBeCloseTo(10, 5);
  });
});
