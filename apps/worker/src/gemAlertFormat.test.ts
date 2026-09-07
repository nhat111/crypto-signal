import { describe, expect, it } from 'vitest';
import type { GemPair, SafetyReport } from '@crypto-signal/gem-scanner';
import { formatGemAlert } from './gemScan.js';

function pair(): GemPair {
  return {
    chainId: 'bsc',
    pairAddress: 'pool1',
    dexId: 'pancakeswap',
    baseToken: { address: '0xabc', name: 'Test Token', symbol: 'TEST' },
    quoteToken: { address: '0xdef', symbol: 'WBNB' },
    priceUsd: 0.01,
    liquidityUsd: 240_000,
    fdvUsd: 5_000_000,
    marketCapUsd: 4_000_000,
    volume: { h1: 20_000, h6: 120_000, h24: 1_200_000 },
    priceChangePct: { m5: 0.2, h1: 1, h6: 4, h24: 18.4 },
    txns: { h1: { buys: 60, sells: 40 }, h24: { buys: 412, sells: 380 } },
    pairCreatedAt: 0,
    url: null,
    websites: [],
    socials: [],
    fetchedAt: 0,
  };
}

const evaluation = {
  eligible: true,
  failures: [],
  score: 78,
  components: null,
  riskScore: 34,
  riskComponents: {},
  reasons: ['Liquidity $240K.', 'Pool is 23 days old.'],
  ageDays: 23,
} as never;

const safety = (verdict: SafetyReport['verdict']): SafetyReport => ({
  chainId: 'solana',
  tokenAddress: 'tok',
  verdict,
  flags: [],
  topHolderPct: 8,
  lpLocked: true,
  mintAuthorityRevoked: true,
  freezeAuthorityRevoked: true,
  checkedAt: 0,
});

/** Everything above the score line — what a reader sees before the number. */
const beforeScore = (text: string) => text.slice(0, text.indexOf('Gem Score'));

describe('formatGemAlert warns before it scores', () => {
  it('puts "no safety screen" above the score, not below it', () => {
    // The reason this moved: the same sentence sat at position six of the
    // reasons list, under a headline score of 78, and did not land. An
    // alert's default reading is "worth acting on", so the fact that
    // contradicts it has to arrive first.
    const text = formatGemAlert({ pair: pair(), evaluation, safety: null });
    expect(beforeScore(text)).toContain('CHƯA QUÉT ĐƯỢC AN TOÀN');
    expect(beforeScore(text)).toContain('honeypot');
  });

  it('warns just as loudly when a screen ran and concluded nothing', () => {
    // 'unknown' is a first-class outcome in this codebase and is never
    // "safe" — a screen that could not confirm anything is not a screen.
    const text = formatGemAlert({ pair: pair(), evaluation, safety: safety('unknown') });
    expect(beforeScore(text)).toContain('KHÔNG XONG');
  });

  it('stays quiet when a screen actually ran and cleared it', () => {
    for (const verdict of ['safe', 'caution'] as const) {
      const text = formatGemAlert({ pair: pair(), evaluation, safety: safety(verdict) });
      expect(beforeScore(text), verdict).not.toContain('⚠️');
    }
  });

  it('still carries the evidence list underneath', () => {
    // The warning is added, not substituted — the reasons are what let
    // somebody check the claim.
    const text = formatGemAlert({ pair: pair(), evaluation, safety: null });
    expect(text).toContain('Liquidity $240K.');
    expect(text).toContain('Pool is 23 days old.');
    expect(text.indexOf('CHƯA QUÉT')).toBeLessThan(text.indexOf('Gem Score'));
  });

  it('escapes a token name that tries to be markup', () => {
    // Names come from on-chain metadata anyone can set, and the message is
    // parsed as HTML.
    const hostile = pair();
    hostile.baseToken.name = '<b>Not bold</b>';
    const text = formatGemAlert({ pair: hostile, evaluation, safety: null });
    expect(text).toContain('&lt;b&gt;Not bold&lt;/b&gt;');
  });
});
