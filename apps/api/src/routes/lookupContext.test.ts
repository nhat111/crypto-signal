import { describe, expect, it } from 'vitest';
import type { CoinScanRow, FlywheelStoredRow, SectorRow } from '@crypto-signal/db';
import { baseAsset, buildLookupContext } from './lookupContext.js';

const scanRow = (symbol: string) => ({ symbol, day: '2026-10-20', flow: 'up_unconfirmed' }) as unknown as CoinScanRow;
const sector = (name: string, label: SectorRow['label'], leaders: string[]) =>
  ({ categoryId: name.toLowerCase(), name, label, leaders: leaders.map((s, i) => ({ symbol: s, name: s, change7dPct: 10 - i })) }) as unknown as SectorRow;
const fw = (symbol: string | null, holdersRevenue30dUsd: number) =>
  ({ name: `${symbol}-proj`, symbol, holdersRevenue30dUsd, holdersRevenueChangePct: 5, yieldPct: 3, priceChange30dPct: -2, mechanism: 'buyback' }) as unknown as FlywheelStoredRow;

describe('baseAsset', () => {
  it('strips the quote the lookup matched, longest first', () => {
    expect(baseAsset('INJUSDT')).toBe('INJ');
    expect(baseAsset('ethfdusd')).toBe('ETH');
    expect(baseAsset('SOLBTC')).toBe('SOL');
    expect(baseAsset('USDT')).toBe('USDT');
  });
});

describe('buildLookupContext', () => {
  it('finds the scan row, every sector it leads, and its flywheel by ticker', () => {
    const ctx = buildLookupContext(
      'INJUSDC',
      { day: '2026-10-20', rows: [scanRow('BTCUSDT'), scanRow('INJUSDT')] },
      [sector('RWA', 'emerging', ['CARDS', 'INJ', 'ZBCN']), sector('Layer 1', 'lagging', ['PEARL', 'INJ']), sector('AI', 'fading', ['TAO'])],
      [fw('INJ', 1e5), fw('INJ', 5e5), fw(null, 9e9)],
    );
    expect(ctx.coinScan?.symbol).toBe('INJUSDT');
    expect(ctx.coinScanSize).toBe(2);
    expect(ctx.sectors.map((s) => [s.name, s.label, s.rank])).toEqual([
      ['RWA', 'emerging', 2],
      ['Layer 1', 'lagging', 2],
    ]);
    expect(ctx.flywheel?.holdersRevenue30dUsd).toBe(5e5);
  });

  it('says nothing it does not know', () => {
    const ctx = buildLookupContext('NEWUSDT', { day: null, rows: [] }, [], []);
    expect(ctx).toEqual({ coinScan: null, coinScanDay: null, coinScanSize: 0, sectors: [], flywheel: null });
  });
});
