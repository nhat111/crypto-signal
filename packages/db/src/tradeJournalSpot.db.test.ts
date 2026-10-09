import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, hasTestDatabase, lockTestTables } from './testPool.js';
import { getOpenTradeForSymbol, getTradeSourceStats, getTrades, insertTrade, updateTrade } from './tradeJournal.js';

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

describe.skipIf(!hasTestDatabase)('trade sources against real Postgres', () => {
  let pool: Pool;
  let releaseLock: () => Promise<void>;
  const CHAT = 'test-sources';

  beforeAll(async () => {
    pool = createTestPool();
    releaseLock = await lockTestTables(pool, TRADE_TABLES_LOCK);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM trade_journal WHERE chat_id = $1', [CHAT]);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM trade_journal WHERE chat_id = $1', [CHAT]);
    await releaseLock();
    await pool.end();
  });

  async function closed(source: string | null, entry: number, exit: number) {
    const t = await insertTrade(pool, { chatId: CHAT, symbol: 'AAA', side: 'spot', entryPrice: entry, size: 1, note: null, source });
    return updateTrade(pool, t.id, { exitPrice: exit });
  }

  it('groups one account however it was capitalised, and keeps the unsourced trades as their own row', async () => {
    await closed('@cryptocred', 100, 110);
    await closed('@CryptoCred', 100, 90);
    await closed(null, 100, 120);
    await insertTrade(pool, { chatId: CHAT, symbol: 'BBB', side: 'spot', entryPrice: 1, size: null, note: null, source: ' @CryptoCred ' });

    const stats = await getTradeSourceStats(pool, CHAT);
    expect(stats).toHaveLength(2);

    const cred = stats.find((s) => s.source !== null)!;
    expect(cred.source).toBe('@CryptoCred');
    expect(cred.closedCount).toBe(2);
    expect(cred.openCount).toBe(1);
    expect(cred.wins).toBe(1);
    expect(cred.winRatePct).toBe(50);
    expect(cred.totalPnlUsd).toBeCloseTo(0);

    const none = stats.find((s) => s.source === null)!;
    expect(none.closedCount).toBe(1);
    expect(none.avgPnlPct).toBeCloseTo(20);
  });

  it('round-trips source and thesis, and a patch to blank clears them', async () => {
    const t = await insertTrade(pool, { chatId: CHAT, symbol: 'CCC', side: 'spot', entryPrice: 1, size: null, note: null, source: 'tự phân tích', thesis: 'hồi về hỗ trợ 1D' });
    expect(t.source).toBe('tự phân tích');
    expect(t.thesis).toBe('hồi về hỗ trợ 1D');
    const cleared = await updateTrade(pool, t.id, { source: '  ', thesis: null });
    expect(cleared?.source).toBeNull();
    expect(cleared?.thesis).toBeNull();
  });
});
