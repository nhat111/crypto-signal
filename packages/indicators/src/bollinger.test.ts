import { describe, expect, it } from 'vitest';
import { computeBollingerBands } from './bollinger.js';

describe('computeBollingerBands', () => {
  it('returns null before a full period of history exists', () => {
    const closes = Array.from({ length: 19 }, () => 100);
    expect(computeBollingerBands(closes, 20)).toBeNull();
  });

  it('collapses upper/middle/lower to the same value for a perfectly flat series (zero stddev)', () => {
    const closes = Array.from({ length: 20 }, () => 100);
    const bands = computeBollingerBands(closes, 20);
    expect(bands).toEqual({ upper: 100, middle: 100, lower: 100 });
  });

  it('widens the band with volatility and keeps it centered on the mean', () => {
    // 10 closes at 90, 10 at 110 — mean 100, population stddev 10.
    const closes = [...Array(10).fill(90), ...Array(10).fill(110)];
    const bands = computeBollingerBands(closes, 20, 2);
    expect(bands).not.toBeNull();
    expect(bands!.middle).toBeCloseTo(100, 5);
    expect(bands!.upper).toBeCloseTo(120, 5);
    expect(bands!.lower).toBeCloseTo(80, 5);
  });

  it('only looks at the most recent `period` closes, not the whole history', () => {
    // A huge spike far in the past should not affect a window that no longer includes it.
    const stale = Array.from({ length: 50 }, () => 100_000);
    const recent = Array.from({ length: 20 }, () => 100);
    const bands = computeBollingerBands([...stale, ...recent], 20);
    expect(bands).toEqual({ upper: 100, middle: 100, lower: 100 });
  });

  it('respects a custom multiplier', () => {
    const closes = [...Array(10).fill(90), ...Array(10).fill(110)];
    const tight = computeBollingerBands(closes, 20, 1);
    expect(tight!.upper).toBeCloseTo(110, 5);
    expect(tight!.lower).toBeCloseTo(90, 5);
  });
});
