import { describe, expect, it } from 'vitest';
import type { OpenInterestPoint } from '@crypto-signal/shared';
import { computeOiChange, interpretOiVsPrice } from './openInterest.js';

function point(sumOpenInterest: number): OpenInterestPoint {
  return { symbol: 'BTCUSDT', timeframe: '15m', timestamp: 0, sumOpenInterest, sumOpenInterestValue: sumOpenInterest * 65000 };
}

describe('computeOiChange', () => {
  it('returns zeros when there is no previous point (cold start)', () => {
    const result = computeOiChange(point(100), undefined, '15m');
    expect(result).toEqual({ changePct: 0, changeAbs: 0, velocityPctPerHour: 0 });
  });

  it('computes % change and normalizes velocity to per-hour', () => {
    const result = computeOiChange(point(110), point(100), '15m');
    expect(result.changePct).toBeCloseTo(10, 5);
    // 15m = 0.25h, so 10% over 15m = 40%/hour
    expect(result.velocityPctPerHour).toBeCloseTo(40, 5);
  });
});

describe('interpretOiVsPrice — spec §8 table, informational only', () => {
  it('price up + OI up => new positions entering', () => {
    expect(interpretOiVsPrice(1, 3, 0.3, 2)).toBe('new_positions_entering_up');
  });

  it('price up + OI down => short covering possible', () => {
    expect(interpretOiVsPrice(1, -3, 0.3, 2)).toBe('short_covering_possible');
  });

  it('price down + OI up => new positions entering (short side)', () => {
    expect(interpretOiVsPrice(-1, 3, 0.3, 2)).toBe('new_positions_entering_down');
  });

  it('price down + OI down => long liquidation or closing possible', () => {
    expect(interpretOiVsPrice(-1, -3, 0.3, 2)).toBe('long_liquidation_or_closing_possible');
  });

  it('below both thresholds => inconclusive, never forced into a bucket', () => {
    expect(interpretOiVsPrice(0.05, 0.1, 0.3, 2)).toBe('inconclusive');
  });
});
