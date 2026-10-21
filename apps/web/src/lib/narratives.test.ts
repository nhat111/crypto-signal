import { describe, expect, it } from 'vitest';
import { signedPct, sortFlywheel } from './narratives';
import type { FlywheelRow } from './types';

const row = (name: string, o: Partial<FlywheelRow>): FlywheelRow => ({
  day: '2026-10-21',
  familyKey: name,
  name,
  symbol: null,
  geckoId: null,
  category: null,
  holdersRevenue30dUsd: 1,
  holdersRevenuePrev30dUsd: null,
  holdersRevenueChangePct: null,
  annualizedUsd: 12,
  marketCapUsd: null,
  yieldPct: null,
  priceChange30dPct: null,
  mechanism: null,
  sources: [],
  reasons: [],
  unknowns: [],
  ...o,
});

describe('sortFlywheel', () => {
  const rows = [row('a', { holdersRevenue30dUsd: 5, yieldPct: null }), row('b', { holdersRevenue30dUsd: 9, yieldPct: 2 }), row('c', { holdersRevenue30dUsd: 1, yieldPct: 30 })];
  it('answers each question separately and puts unknowns last', () => {
    expect(sortFlywheel(rows, 'revenue').map((r) => r.name)).toEqual(['b', 'a', 'c']);
    expect(sortFlywheel(rows, 'yield').map((r) => r.name)).toEqual(['c', 'b', 'a']);
  });
});

describe('signedPct', () => {
  it('signs and dashes', () => {
    expect(signedPct(3.21)).toBe('+3.2%');
    expect(signedPct(-4)).toBe('-4.0%');
    expect(signedPct(null)).toBe('—');
  });
});
