import { describe, expect, it } from 'vitest';
import { breadthWord, pctTone, signedPct, sortFlywheel } from './narratives';
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

  it('never prints a negative zero', () => {
    expect(signedPct(-0.004)).toBe('0.0%');
    expect(signedPct(-0.4, 0)).toBe('0%');
    expect(pctTone(-0.004)).toBe('text-slate-300');
    expect(pctTone(-0.06)).toBe('text-rose-300');
  });
});

describe('breadthWord', () => {
  it('matches the shared edges', () => {
    expect(breadthWord(65).text).toBe('Rộng');
    expect(breadthWord(57).text).toBe('Vừa');
    expect(breadthWord(35).text).toBe('Vừa');
    expect(breadthWord(16).text).toBe('Ít');
  });
});
