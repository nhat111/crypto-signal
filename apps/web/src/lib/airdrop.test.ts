import { describe, expect, it } from 'vitest';
import { activeFarmFor, filterCandidates, formatAgoVi, formatFarmUsd, parseCostInput, sortCandidates } from './airdrop';
import type { AirdropCandidate, Farm } from './types';

const c = (name: string, o: Partial<AirdropCandidate> = {}): AirdropCandidate => ({
  day: '2026-10-21',
  slug: name.toLowerCase(),
  name,
  category: 'Dexs',
  chains: ['Base'],
  tvlUsd: 1,
  change1dPct: null,
  change7dPct: null,
  change30dPct: null,
  url: null,
  twitter: null,
  logo: null,
  listedAtMs: null,
  audits: null,
  parentSlug: null,
  reasons: [],
  unknowns: [],
  ...o,
});

describe('sortCandidates', () => {
  const list = [c('A', { tvlUsd: 5, change7dPct: null }), c('B', { tvlUsd: 9, change7dPct: -4 }), c('C', { tvlUsd: 1, change7dPct: 30 })];

  it('orders by the chosen question and puts unknowns last', () => {
    expect(sortCandidates(list, 'tvl').map((x) => x.name)).toEqual(['B', 'A', 'C']);
    expect(sortCandidates(list, 'growth7d').map((x) => x.name)).toEqual(['C', 'B', 'A']);
  });

  it('does not reorder the input', () => {
    sortCandidates(list, 'tvl');
    expect(list.map((x) => x.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('filterCandidates', () => {
  it('matches name, category or chain', () => {
    const list = [c('Curvance', { category: 'Lending', chains: ['Monad'] }), c('Other')];
    expect(filterCandidates(list, 'monad').map((x) => x.name)).toEqual(['Curvance']);
    expect(filterCandidates(list, 'lend').map((x) => x.name)).toEqual(['Curvance']);
    expect(filterCandidates(list, '  ')).toHaveLength(2);
  });
});

describe('parseCostInput', () => {
  it('reads a comma decimal, treats blank as free and refuses negatives', () => {
    expect(parseCostInput('0,35')).toBe(0.35);
    expect(parseCostInput('')).toBe(0);
    expect(parseCostInput('-1')).toBeNull();
    expect(parseCostInput('abc')).toBeNull();
  });
});

describe('activeFarmFor', () => {
  it('matches by slug or by the folded name, active farms only', () => {
    const farm = { status: 'active', slug: null, projectKey: 'polymarket international' } as Farm;
    expect(activeFarmFor(c('Polymarket  International'), [farm])).toBe(farm);
    expect(activeFarmFor(c('Polymarket International'), [{ ...farm, status: 'dropped' }])).toBeUndefined();
  });
});

describe('formatFarmUsd', () => {
  it('puts the minus before the dollar sign', () => {
    expect(formatFarmUsd(-1.55)).toBe('-$1.55');
    expect(formatFarmUsd(36)).toBe('$36');
  });
});

describe('formatAgoVi', () => {
  it('reads in Vietnamese', () => {
    const now = 10 * 86_400_000;
    expect(formatAgoVi(now - 20_000, now)).toBe('vừa xong');
    expect(formatAgoVi(now - 5 * 60_000, now)).toBe('5 phút trước');
    expect(formatAgoVi(now - 3 * 3_600_000, now)).toBe('3 giờ trước');
    expect(formatAgoVi(now - 2 * 86_400_000, now)).toBe('2 ngày trước');
  });
});
