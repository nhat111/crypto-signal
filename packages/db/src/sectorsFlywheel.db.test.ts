import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { FlywheelRow, SectorRead } from '@crypto-signal/indicators';
import { createTestPool, hasTestDatabase } from './testPool.js';
import {
  getLatestFlywheel,
  getLatestSectors,
  getStoredSectorIds,
  hasFlywheelDay,
  replaceFlywheelDay,
  upsertSectorRead,
} from './sectorsFlywheel.js';

const sector = (categoryId: string, rs7d: number, label: SectorRead['label']): SectorRead => ({
  categoryId,
  name: categoryId,
  coinCount: 10,
  median7dPct: rs7d,
  median30dPct: 0,
  rs7d,
  rs30d: 1,
  breadth7dPct: 50,
  breadth30dPct: 50,
  weighted7dPct: null,
  btc7dPct: 0,
  btc30dPct: -1,
  label,
  leaders: [{ symbol: 'A', name: 'a', change7dPct: 9 }],
  reasons: ['r'],
});

const flywheel = (familyKey: string, holdersRevenue30dUsd: number): FlywheelRow => ({
  familyKey,
  name: familyKey,
  symbol: 'X',
  geckoId: null,
  category: null,
  holdersRevenue30dUsd,
  holdersRevenuePrev30dUsd: null,
  holdersRevenueChangePct: null,
  annualizedUsd: holdersRevenue30dUsd * 12,
  marketCapUsd: null,
  yieldPct: null,
  priceChange30dPct: null,
  mechanism: 'buyback',
  sources: ['x'],
  reasons: ['r'],
  unknowns: [],
});

describe.skipIf(!hasTestDatabase)('sector and flywheel storage against real Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query("DELETE FROM sector_days WHERE day >= '2099-01-01'");
    await pool.query("DELETE FROM flywheel_days WHERE day >= '2099-01-01'");
  });
  afterAll(async () => {
    await pool.query("DELETE FROM sector_days WHERE day >= '2099-01-01'");
    await pool.query("DELETE FROM flywheel_days WHERE day >= '2099-01-01'");
    await pool.end();
  });

  it('stores sectors per day, orders by 7-day strength and carries the previous label', async () => {
    await upsertSectorRead(pool, '2099-01-01', sector('ai', 3, 'emerging'));
    await upsertSectorRead(pool, '2099-01-02', sector('ai', 5, 'leading'));
    await upsertSectorRead(pool, '2099-01-02', sector('meme', -4, 'lagging'));
    // A rerun overwrites rather than duplicates.
    await upsertSectorRead(pool, '2099-01-02', sector('meme', -2, 'lagging'));

    expect(await getStoredSectorIds(pool, '2099-01-02')).toEqual(new Set(['ai', 'meme']));
    const latest = await getLatestSectors(pool);
    expect(latest.day).toBe('2099-01-02');
    expect(latest.sectors.map((s) => [s.categoryId, s.rs7d, s.previousLabel])).toEqual([
      ['ai', 5, 'emerging'],
      ['meme', -2, null],
    ]);
    expect(latest.sectors[0]?.leaders[0]?.symbol).toBe('A');
  });

  it('replaces a flywheel day and reads it largest first', async () => {
    await replaceFlywheelDay(pool, '2099-01-02', [flywheel('a', 1), flywheel('gone', 5)]);
    await replaceFlywheelDay(pool, '2099-01-02', [flywheel('a', 1), flywheel('b', 3)]);
    expect(await hasFlywheelDay(pool, '2099-01-02')).toBe(true);
    expect(await hasFlywheelDay(pool, '2099-01-03')).toBe(false);
    const latest = await getLatestFlywheel(pool);
    expect(latest.rows.map((r) => r.familyKey)).toEqual(['b', 'a']);
    expect(latest.rows[0]).toMatchObject({ mechanism: 'buyback', sources: ['x'], marketCapUsd: null });
  });
});
