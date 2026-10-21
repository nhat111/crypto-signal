import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, getJobHealth, getStoredSectorIds, hasTestDatabase, JOB_SECTOR_SCAN } from '@crypto-signal/db';
import type { CoinMarket } from '@crypto-signal/market-data';
import type { Logger } from '@crypto-signal/shared';
import { runSectorScanCycle } from './sectorScan.js';
import { runFlywheelCycle } from './flywheelScan.js';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
const NOW = Date.UTC(2097, 2, 3, 12);
const DAY = '2097-03-03';

const market = (id: string, change7dPct: number, change30dPct: number): CoinMarket => ({
  id,
  symbol: id.toUpperCase(),
  name: id,
  priceUsd: 1,
  marketCapUsd: 1e9,
  change7dPct,
  change30dPct,
});
const five = (base: number) => ['a', 'b', 'c', 'd', 'e'].map((x, i) => market(`${x}${base}`, base + i, base));

describe.skipIf(!hasTestDatabase)('sector and flywheel cycles against real Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    await pool.query('DELETE FROM sector_days WHERE day = $1', [DAY]);
    await pool.query('DELETE FROM flywheel_days WHERE day = $1', [DAY]);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM sector_days WHERE day = $1', [DAY]);
    await pool.query('DELETE FROM flywheel_days WHERE day = $1', [DAY]);
    await pool.end();
  });

  it('stores what it can, and the next run fetches only the missing categories', async () => {
    const config = { enabled: true, categories: ['ai', 'meme', 'broken'], coinsPerCategory: 30, coingeckoApiKey: '' };
    const fetchCategory = vi.fn(async (id: string) => {
      if (id === 'stablecoins') return [market('usdt', 0, 0)];
      if (id === 'broken') throw new Error('HTTP 429');
      return five(id === 'ai' ? 10 : -10);
    });
    const markets = { fetchIds: async () => [market('bitcoin', 2, 1)], fetchCategory };
    await runSectorScanCycle({ pool, logger, config, markets, nowMs: NOW, pauseMs: 0 });
    expect(await getStoredSectorIds(pool, DAY)).toEqual(new Set(['ai', 'meme']));
    expect((await getJobHealth(pool, JOB_SECTOR_SCAN))?.consecutiveFailures).toBe(0);

    fetchCategory.mockClear();
    await runSectorScanCycle({ pool, logger, config, markets, nowMs: NOW, pauseMs: 0 });
    expect(fetchCategory.mock.calls.map((c) => c[0])).toEqual(['stablecoins', 'broken']);
  });

  it('stores the flywheel day once and prices it from CoinGecko', async () => {
    const source = {
      fetchHoldersRevenue: vi.fn(async () => [
        { name: 'Perps', defillamaId: '1', slug: 'perps', category: 'Derivatives', isChain: false, parentProtocol: 'parent#x', total30d: 5e6, total60dto30d: 4e6, mechanism: 'buyback' },
      ]),
      fetchTokenDirectory: async () => ({
        protocols: new Map(),
        parents: new Map([['parent#x', { name: 'X', symbol: 'X', geckoId: 'x-token', mcapUsd: 1 }]]),
        chains: new Map(),
      }),
    };
    const markets = { fetchIds: async () => [market('x-token', 0, -20)] };
    const config = { enabled: true, minHoldersRevenue30dUsd: 100_000, maxRows: 10 };
    await runFlywheelCycle({ pool, logger, config, source, markets, nowMs: NOW });
    await runFlywheelCycle({ pool, logger, config, source, markets, nowMs: NOW });
    expect(source.fetchHoldersRevenue).toHaveBeenCalledTimes(1);
    // Read by day, not "latest": the db package's tests store far-future days in parallel.
    const { rows } = await pool.query('SELECT name, market_cap_usd, price_change_30d_pct FROM flywheel_days WHERE day = $1', [DAY]);
    expect(rows).toEqual([{ name: 'X', market_cap_usd: 1e9, price_change_30d_pct: -20 }]);
  });
});
