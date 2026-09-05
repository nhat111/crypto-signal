import { describe, expect, it } from 'vitest';
import { computeAtrPct, computeBaselineAtrPct, MIN_BASELINE_RANGES } from './volatility.js';

describe('computeBaselineAtrPct', () => {
  const ranges = (n: number, value: number) => Array.from({ length: n }, () => value);

  it('is the mean range as a share of the reference price', () => {
    // Ten ranges of 100 on a 10.000 price: 1% per candle.
    expect(computeBaselineAtrPct(ranges(10, 100), 10_000)).toBeCloseTo(1, 9);
  });

  it('refuses to answer on a short history', () => {
    // Null, not zero. A missing baseline read as "volatility is zero" makes
    // every move infinitely abnormal, which is precisely backwards on a
    // cold start when nothing is known yet.
    expect(computeBaselineAtrPct(ranges(MIN_BASELINE_RANGES - 1, 100), 10_000)).toBeNull();
    expect(computeBaselineAtrPct(ranges(MIN_BASELINE_RANGES, 100), 10_000)).not.toBeNull();
  });

  it('refuses to answer on a market that has not moved at all', () => {
    // Every range zero would make the ratio a division by zero and turn
    // any tick into an infinite shock.
    expect(computeBaselineAtrPct(ranges(14, 0), 10_000)).toBeNull();
  });

  it('refuses to answer without a usable price', () => {
    expect(computeBaselineAtrPct(ranges(14, 100), 0)).toBeNull();
    expect(computeBaselineAtrPct(ranges(14, 100), -5)).toBeNull();
  });

  it('is not moved by the candle being judged', () => {
    // The property the whole shock detector rests on. `atrPct` on the
    // snapshot includes the current true range, so a violent candle
    // inflates its own denominator; the baseline must not. Same history,
    // one enormous candle appended — the baseline is unchanged and the
    // including-the-candle figure is nearly three times larger.
    const history = ranges(14, 100);
    const baseline = computeBaselineAtrPct(history, 10_000);
    const withCurrent = computeAtrPct(
      [...history, 2_500].reduce((a, b) => a + b, 0) / (history.length + 1),
      10_000,
    );
    expect(baseline).toBeCloseTo(1, 9);
    expect(withCurrent).toBeGreaterThan(2.5);
  });
});
