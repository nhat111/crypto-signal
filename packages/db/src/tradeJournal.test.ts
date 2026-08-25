import { describe, expect, it } from 'vitest';
import { computeTradePnl } from './tradeJournal.js';

describe('computeTradePnl', () => {
  it('is positive for a long that closed above entry', () => {
    const { pnlPct, pnlUsd } = computeTradePnl('long', 100, 110, 2);
    expect(pnlPct).toBeCloseTo(10, 5);
    expect(pnlUsd).toBeCloseTo(20, 5);
  });

  it('is negative for a long that closed below entry', () => {
    const { pnlPct, pnlUsd } = computeTradePnl('long', 100, 90, 2);
    expect(pnlPct).toBeCloseTo(-10, 5);
    expect(pnlUsd).toBeCloseTo(-20, 5);
  });

  it('flips the sign for a short — price rising is a loss, falling is a gain', () => {
    const roseAgainstShort = computeTradePnl('short', 100, 110, 2);
    expect(roseAgainstShort.pnlPct).toBeCloseTo(-10, 5);
    expect(roseAgainstShort.pnlUsd).toBeCloseTo(-20, 5);

    const fellForShort = computeTradePnl('short', 100, 90, 2);
    expect(fellForShort.pnlPct).toBeCloseTo(10, 5);
    expect(fellForShort.pnlUsd).toBeCloseTo(20, 5);
  });

  it('returns a null $ P&L when no size was recorded, but still knows the %', () => {
    const { pnlPct, pnlUsd } = computeTradePnl('long', 100, 105, null);
    expect(pnlPct).toBeCloseTo(5, 5);
    expect(pnlUsd).toBeNull();
  });
});
