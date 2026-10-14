import { describe, expect, it } from 'vitest';
import { FLOW_META, edgeVerdictText, sortCoins } from './coinFlow';
import type { CoinScanRow } from './types';

const row = (symbol: string, volumeRank: number, rs30d: number | null, rs7d: number | null): CoinScanRow =>
  ({ symbol, volumeRank, rs30d, rs7d }) as CoinScanRow;

describe('sortCoins', () => {
  const rows = [row('A', 1, 5, 1), row('B', 2, null, 9), row('C', 3, -2, 3), row('D', 4, null, null)];

  it('sorts by 30-day strength, falling back to 7 days for young coins, unreadable last', () => {
    expect(sortCoins(rows, 'rs30').map((r) => r.symbol)).toEqual(['B', 'A', 'C', 'D']);
  });

  it('sorts by 7-day strength and by volume rank', () => {
    expect(sortCoins(rows, 'rs7').map((r) => r.symbol)).toEqual(['B', 'C', 'A', 'D']);
    expect(sortCoins([...rows].reverse(), 'volume').map((r) => r.symbol)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('FLOW_META', () => {
  it('labels every flow the API can send', () => {
    expect(Object.keys(FLOW_META)).toHaveLength(14);
    for (const meta of Object.values(FLOW_META)) expect(meta.label.length).toBeGreaterThan(0);
  });
});

describe('edgeVerdictText', () => {
  const g = (samples: number, hitPct: number | null = 50) => ({ samples, hitPct, meanExcessPct: 0 });
  it('says how far from the sample floor a comparison is', () => {
    expect(edgeVerdictText({ group: g(7), baseline: g(40), verdict: null, deltaPp: null, marginPp: null }, 20).text).toBe('Chưa đủ dữ liệu (7/20 mẫu)');
  });
  it('words each verdict', () => {
    const base = { group: g(30), baseline: g(30), deltaPp: 1, marginPp: 1 };
    expect(edgeVerdictText({ ...base, verdict: 'beats' }, 20)).toEqual({ text: 'Có lợi thế thật', tone: 'good' });
    expect(edgeVerdictText({ ...base, verdict: 'worse' }, 20).tone).toBe('bad');
    expect(edgeVerdictText({ ...base, verdict: 'indistinguishable' }, 20).text).toContain('Chưa phân biệt');
  });
});
