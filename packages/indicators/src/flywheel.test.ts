import { describe, expect, it } from 'vitest';
import { readFlywheels, type FlywheelDirectory, type FlywheelFeeInput } from './flywheel.js';

const fee = (o: Partial<FlywheelFeeInput>): FlywheelFeeInput => ({
  name: 'X',
  defillamaId: '1',
  category: 'Dexs',
  isChain: false,
  parentProtocol: null,
  total30d: 1_000_000,
  total60dto30d: 1_000_000,
  mechanism: null,
  ...o,
});

const dir: FlywheelDirectory = {
  protocols: new Map([
    ['1', { name: 'Solo', symbol: 'SOLO', geckoId: 'solo', mcapUsd: 120_000_000 }],
    ['9', { name: 'NoToken', symbol: null, geckoId: null, mcapUsd: null }],
  ]),
  parents: new Map([['parent#hl', { name: 'Hyperliquid', symbol: 'HYPE', geckoId: 'hyperliquid', mcapUsd: 1 }]]),
  chains: new Map([['Tron', { name: 'Tron', symbol: 'TRX', geckoId: 'tron', mcapUsd: null }]]),
};

const thresholds = { minHoldersRevenue30dUsd: 100_000, maxRows: 50 };

describe('readFlywheels', () => {
  it('sums a family under its parent and prices it from CoinGecko first', () => {
    const rows = readFlywheels(
      [
        fee({ name: 'Hyperliquid Perps', defillamaId: '5507', parentProtocol: 'parent#hl', total30d: 60e6, total60dto30d: 40e6, mechanism: 'buyback' }),
        fee({ name: 'Hyperliquid Spot', defillamaId: '5508', parentProtocol: 'parent#hl', total30d: 6e6, total60dto30d: 4e6 }),
      ],
      dir,
      new Map([['hyperliquid', { marketCapUsd: 13_200e6, change30dPct: -15 }]]),
      thresholds,
    );
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r?.name).toBe('Hyperliquid');
    expect(r?.holdersRevenue30dUsd).toBe(66e6);
    expect(r?.holdersRevenueChangePct).toBeCloseTo(50);
    expect(r?.yieldPct).toBeCloseTo((66e6 * 365) / 30 / 13_200e6 * 100);
    expect(r?.sources).toEqual(['Hyperliquid Perps', 'Hyperliquid Spot']);
    expect(r?.reasons.join(' | ')).toContain('Lệch pha');
    expect(r?.mechanism).toBe('buyback');
  });

  it('falls back to DefiLlama market cap and resolves chains by name', () => {
    const rows = readFlywheels(
      [fee({}), fee({ name: 'Tron', defillamaId: 'chain#tron', isChain: true, total30d: 20e6, total60dto30d: null })],
      dir,
      new Map(),
      thresholds,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['TRX', 'SOLO']);
    expect(rows[0]?.unknowns.join(' | ')).toContain('Không có vốn hoá');
    expect(rows[0]?.unknowns.join(' | ')).toContain('30 ngày trước');
    expect(rows[1]?.marketCapUsd).toBe(120_000_000);
    expect(rows[1]?.category).toBe('Dexs');
  });

  it('skips small payouts, payouts with no token and unknown families', () => {
    const rows = readFlywheels(
      [fee({ total30d: 50_000 }), fee({ defillamaId: '9' }), fee({ defillamaId: null }), fee({ defillamaId: '404' })],
      dir,
      new Map(),
      thresholds,
    );
    expect(rows).toEqual([]);
  });

  it('flags a yield too high to be a run rate', () => {
    const [r] = readFlywheels([fee({ total30d: 10e6 })], dir, new Map([['solo', { marketCapUsd: 20e6, change30dPct: 0 }]]), thresholds);
    expect(r?.unknowns.join(' | ')).toContain('trên 50%/năm');
  });
});
