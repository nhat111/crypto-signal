import { describe, expect, it } from 'vitest';
import { hasToken, screenAirdropCandidates, tokenizedParents, type AirdropProtocolInput } from './airdrop.js';

const NOW = Date.UTC(2026, 9, 21);
const DAY = 86_400_000;
const thresholds = { minTvlUsd: 10_000_000, maxCandidates: 100 };

function protocol(overrides: Partial<AirdropProtocolInput> = {}): AirdropProtocolInput {
  return {
    name: 'Curvance',
    slug: 'curvance',
    symbol: '-',
    gecko_id: null,
    cmcId: null,
    category: 'Lending',
    chains: ['Monad', 'Ethereum', 'Arbitrum'],
    tvl: 132_000_000,
    change_1d: 1,
    change_7d: 31,
    url: 'https://curvance.com',
    twitter: 'Curvance',
    audits: '2',
    listedAt: (NOW - 40 * DAY) / 1000,
    ...overrides,
  };
}

describe('hasToken', () => {
  it('reads DefiLlama\'s "-" as no symbol', () => {
    expect(hasToken(protocol())).toBe(false);
    expect(hasToken(protocol({ symbol: 'CRV' }))).toBe(true);
    expect(hasToken(protocol({ gecko_id: 'curvance' }))).toBe(true);
    expect(hasToken(protocol({ cmcId: '1115' }))).toBe(true);
  });
});

describe('screenAirdropCandidates', () => {
  const screen = (ps: AirdropProtocolInput[], history = new Map<string, number>()) =>
    screenAirdropCandidates(ps, thresholds, history, NOW);

  it('keeps a tokenless protocol with real TVL and explains why', () => {
    const [c] = screen([protocol()]);
    expect(c?.slug).toBe('curvance');
    expect(c?.reasons.join(' | ')).toContain('Chưa có token');
    expect(c?.reasons.join(' | ')).toContain('+31% trong 7 ngày');
    expect(c?.reasons.join(' | ')).toContain('Mới lên DefiLlama 40 ngày');
    expect(c?.reasons).toContain('Chạy trên 3 chain');
  });

  it('drops tokens, small TVL and dead or custodial entries', () => {
    const out = screen([
      protocol({ slug: 'a', symbol: 'AAA' }),
      protocol({ slug: 'b', tvl: 2_000_000 }),
      protocol({ slug: 'c', deprecated: true }),
      protocol({ slug: 'd', category: 'CEX' }),
      protocol({ slug: 'e', category: 'Risk Curators' }),
      protocol({ slug: 'f', name: 'Binance staked ETH', category: 'Liquid Staking' }),
      protocol({ slug: 'g', name: 'WBTC', category: 'Bridge' }),
      protocol({ slug: 'h', tvl: null }),
      protocol({ slug: 'i', name: 'USDD', category: 'CDP', stablecoins: ['usdd'] }),
    ]);
    expect(out).toEqual([]);
  });

  it('drops a tokenless child of a parent that already has a token', () => {
    const ps = [
      protocol({ slug: 'aave-v3', symbol: 'AAVE', parentProtocolSlug: 'aave' }),
      protocol({ slug: 'aave-v4', parentProtocolSlug: 'aave' }),
      protocol({ slug: 'fresh', parentProtocolSlug: 'fresh-parent' }),
    ];
    expect(tokenizedParents(ps)).toEqual(new Set(['aave']));
    expect(screen(ps).map((c) => c.slug)).toEqual(['fresh']);
  });

  it('computes 30-day TVL change only from stored history, never guessed', () => {
    const [without] = screen([protocol()]);
    expect(without?.change30dPct).toBeNull();
    expect(without?.unknowns.join(' | ')).toContain('Chưa đủ 30 ngày');

    const [withHistory] = screen([protocol()], new Map([['curvance', 66_000_000]]));
    expect(withHistory?.change30dPct).toBeCloseTo(100);
    expect(withHistory?.reasons.join(' | ')).toContain('+100% trong 30 ngày');
  });

  it('flags money leaving and missing audits as unknowns', () => {
    const [c] = screen([protocol({ change_7d: -35, audits: '0', twitter: null })]);
    const text = c?.unknowns.join(' | ') ?? '';
    expect(text).toContain('-35% trong 7 ngày');
    expect(text).toContain('Không thấy audit');
    expect(text).toContain('Không có X/Twitter');
  });

  it('caps the list by TVL, largest first', () => {
    const ps = [10, 50, 30].map((m) => protocol({ slug: `p${m}`, tvl: m * 1_000_000 }));
    const out = screenAirdropCandidates(ps, { minTvlUsd: 1, maxCandidates: 2 }, new Map(), NOW);
    expect(out.map((c) => c.slug)).toEqual(['p50', 'p30']);
  });
});
