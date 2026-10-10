import { describe, expect, it } from 'vitest';
import { emaSeries, lookupSearch, parseLookupParams } from './lookupChart';

describe('emaSeries', () => {
  it('seeds with the simple average, then smooths — the same EMA the trend read uses', () => {
    const values = [1, 2, 3, 4, 5, 6];
    const ema = emaSeries(values, 3);
    expect(ema[0]).toEqual({ index: 2, value: 2 });
    // k = 0.5 for period 3: 4*0.5 + 2*0.5 = 3, then 4, then 5.
    expect(ema.map((p) => p.value)).toEqual([2, 3, 4, 5]);
    expect(ema.at(-1)?.index).toBe(5);
  });

  it('matches packages/indicators computeEma on its last value', () => {
    // computeEma(values, 20) for this series, from the indicators package.
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 10 + i * 0.2);
    const seed = values.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    const k = 2 / 21;
    let expected = seed;
    for (let i = 20; i < values.length; i += 1) expected = values[i]! * k + expected * (1 - k);
    expect(emaSeries(values, 20).at(-1)?.value).toBeCloseTo(expected, 10);
  });

  it('returns nothing when the history is shorter than the period', () => {
    expect(emaSeries([1, 2], 3)).toEqual([]);
    expect(emaSeries([1, 2, 3], 0)).toEqual([]);
  });
});

describe('lookup link params', () => {
  it('round-trips a ticker and frame', () => {
    const search = lookupSearch({ q: 'NEARUSDT', tf: '1h' });
    expect(search).toBe('?q=NEARUSDT&tf=1h');
    expect(parseLookupParams(new URLSearchParams(search))).toEqual({ q: 'NEARUSDT', tf: '1h' });
  });

  it('falls back to 4h for a frame the page does not offer, and trims the query', () => {
    expect(parseLookupParams(new URLSearchParams('?q=%20btc%20&tf=3d'))).toEqual({ q: 'btc', tf: '4h' });
    expect(parseLookupParams(new URLSearchParams(''))).toEqual({ q: '', tf: '4h' });
  });
});
