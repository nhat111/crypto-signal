import { describe, expect, it } from 'vitest';
import { buildOnChainFundamentals } from './fundamentalRead.js';
import type { GemPair, SafetyReport } from '@crypto-signal/gem-scanner';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function pair(overrides: Partial<GemPair> = {}): GemPair {
  return {
    chainId: 'solana',
    pairAddress: 'pool-1',
    dexId: 'raydium',
    baseToken: { address: 'abc', name: 'Test Token', symbol: 'TEST' },
    quoteToken: { address: 'sol', symbol: 'SOL' },
    priceUsd: 0.5,
    liquidityUsd: 200_000,
    fdvUsd: 10_000_000,
    marketCapUsd: 8_000_000,
    volume: { h1: 20_000, h6: 100_000, h24: 400_000 },
    priceChangePct: { m5: 0, h1: 1, h6: 3, h24: 8 },
    txns: { h1: { buys: 10, sells: 8 }, h24: { buys: 300, sells: 220 } },
    pairCreatedAt: NOW - 30 * DAY,
    url: 'https://dexscreener.com/solana/pool-1',
    websites: [{ label: 'Website', url: 'https://example.org' }],
    socials: [{ type: 'twitter', url: 'https://x.com/example' }],
    fetchedAt: NOW,
    ...overrides,
  };
}

const safety: SafetyReport = {
  chainId: 'solana',
  tokenAddress: 'abc',
  verdict: 'safe',
  flags: [],
  topHolderPct: 0.08,
  lpLocked: true,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  checkedAt: NOW,
};

describe('buildOnChainFundamentals', () => {
  it('reports the measurable facts', () => {
    const f = buildOnChainFundamentals(pair(), safety, NOW);
    expect(f.symbol).toBe('TEST');
    expect(f.liquidityUsd).toBe(200_000);
    expect(f.ageDays).toBeCloseTo(30, 6);
    expect(f.buys24h).toBe(300);
    expect(f.safetyVerdict).toBe('safe');
  });

  it('computes depth against valuation, and turnover against depth', () => {
    const f = buildOnChainFundamentals(pair(), safety, NOW);
    expect(f.liquidityToFdvPct).toBeCloseTo(2, 6);
    expect(f.volumeToLiquidity).toBeCloseTo(2, 6);
  });

  /**
   * A ratio against a missing denominator is not a small number, it is not
   * a number — and printing 0 there would read as "no liquidity relative
   * to valuation", which is a claim about the token.
   */
  it('refuses a ratio when either side is unknown', () => {
    expect(buildOnChainFundamentals(pair({ fdvUsd: null }), safety, NOW).liquidityToFdvPct).toBeNull();
    expect(buildOnChainFundamentals(pair({ liquidityUsd: null }), safety, NOW).liquidityToFdvPct).toBeNull();
    expect(buildOnChainFundamentals(pair({ volume: { h1: null, h6: null, h24: null } }), safety, NOW).volumeToLiquidity).toBeNull();
  });

  it('refuses a ratio against a zero denominator rather than dividing', () => {
    expect(buildOnChainFundamentals(pair({ fdvUsd: 0 }), safety, NOW).liquidityToFdvPct).toBeNull();
    expect(buildOnChainFundamentals(pair({ liquidityUsd: 0 }), safety, NOW).volumeToLiquidity).toBeNull();
  });

  it('names every gap instead of quietly leaving it out', () => {
    const f = buildOnChainFundamentals(
      pair({ fdvUsd: null, liquidityUsd: null, pairCreatedAt: null, volume: { h1: null, h6: null, h24: null } }),
      null,
      NOW,
    );
    const text = f.unknowns.join(' | ');
    expect(text).toContain('FDV');
    expect(text).toContain('Liquidity');
    expect(text).toContain('Pool age');
    expect(text).toContain('24h volume');
    expect(text).toContain('Safety screen');
  });

  it('treats a missing safety screen as unknown, never as clean', () => {
    // The rule the whole gem side runs on: a screen that did not run is
    // not a screen that passed.
    const f = buildOnChainFundamentals(pair(), null, NOW);
    expect(f.safetyVerdict).toBeNull();
    expect(f.lpLocked).toBeNull();
    expect(f.mintAuthorityRevoked).toBeNull();
    expect(f.unknowns.join(' ')).toContain('Safety screen');
  });

  it('keeps an unreadable holder distribution distinct from a good one', () => {
    const partial: SafetyReport = { ...safety, topHolderPct: null, lpLocked: null };
    const f = buildOnChainFundamentals(pair(), partial, NOW);
    expect(f.topHolderPct).toBeNull();
    expect(f.unknowns.join(' ')).toContain('Largest holder');
    expect(f.unknowns.join(' ')).toContain('LP');
  });

  it('carries safety flags through verbatim', () => {
    const flagged: SafetyReport = { ...safety, verdict: 'caution', flags: ['Ví lớn nhất giữ 34%'] };
    expect(buildOnChainFundamentals(pair(), flagged, NOW).safetyFlags).toEqual(['Ví lớn nhất giữ 34%']);
  });

  it('has no gaps to report when everything was readable', () => {
    expect(buildOnChainFundamentals(pair(), safety, NOW).unknowns).toEqual([]);
  });

  it('carries the links needed to go and check the numbers', () => {
    // A token page that shows figures and no way to verify them asks to be
    // taken on trust, which is the opposite of what this project is for.
    const f = buildOnChainFundamentals(pair(), safety, NOW);
    expect(f.explorer?.url).toContain('solscan.io');
    expect(f.dexScreenerUrl).toContain('dexscreener.com');
    expect(f.websites.map((w) => w.url)).toEqual(['https://example.org']);
    expect(f.socials).toHaveLength(1);
  });

  it('names the missing explorer instead of just omitting the button', () => {
    // A silently absent link reads as the token having nothing to show,
    // when the truth is that WE have no verified explorer for that chain.
    const f = buildOnChainFundamentals(pair({ chainId: 'robinhood' }), safety, NOW);
    expect(f.explorer).toBeNull();
    expect(f.unknowns.join(' ')).toContain('robinhood');
    expect(f.unknowns.join(' ')).toContain('explorer');
  });

  it('reports a token that submitted no links as a gap, not as an empty list', () => {
    const f = buildOnChainFundamentals(pair({ websites: [], socials: [] }), safety, NOW);
    expect(f.websites).toEqual([]);
    expect(f.unknowns.join(' ')).toContain('Project website');
  });
});
