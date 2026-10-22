import { describe, expect, it } from 'vitest';
import { formatR, stopLabel } from './tradeStop';

describe('tradeStop', () => {
  it('signs R and labels the stop with its $ risk when sized', () => {
    expect(formatR(2)).toBe('+2.00R');
    expect(formatR(-1)).toBe('-1.00R');
    expect(stopLabel({ stopPrice: null })).toBe('no stop');
    expect(stopLabel({})).toBe('no stop');
    expect(stopLabel({ stopPrice: 140, riskUsd: 20 })).toContain('risk $20.00');
  });
});
