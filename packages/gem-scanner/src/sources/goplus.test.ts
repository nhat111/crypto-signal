import { describe, expect, it } from 'vitest';
import {
  GOPLUS_THRESHOLDS,
  GoPlusSource,
  interpretGoPlusReport,
  readFlag,
  readTaxPct,
  toGoPlusChainId,
} from './goplus.js';
import { CompositeSafetySource } from './compositeSafety.js';
import type { ChainId, SafetyReport, SafetySource } from '../types.js';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

/** A payload with everything readable and nothing wrong. */
const clean = {
  is_honeypot: '0',
  cannot_sell_all: '0',
  is_blacklisted: '0',
  is_mintable: '0',
  can_take_back_ownership: '0',
  owner_change_balance: '0',
  hidden_owner: '0',
  selfdestruct: '0',
  transfer_pausable: '0',
  is_open_source: '1',
  buy_tax: '0.01',
  sell_tax: '0.01',
  lp_holders: [{ is_locked: 1, percent: '0.9' }],
  holders: [{ percent: '0.05' }, { percent: '0.04' }],
};

const read = (overrides: Record<string, unknown> = {}) =>
  interpretGoPlusReport('bsc', '0xabc', { ...clean, ...overrides } as never);

describe('readFlag never guesses', () => {
  it('reads GoPlus’s "0"/"1" strings', () => {
    expect(readFlag('1')).toBe(true);
    expect(readFlag('0')).toBe(false);
  });

  it('returns null for anything it cannot read', () => {
    // "We could not tell whether this is a honeypot" and "this is not a
    // honeypot" mean opposite things to a buyer. Coercing the first into
    // the second is the single most expensive mistake this file can make.
    for (const value of [undefined, null, '', ' ', 'true', '2', 'unknown']) {
      expect(readFlag(value as never), String(value)).toBeNull();
    }
  });
});

describe('readTaxPct', () => {
  it('converts the decimal fraction GoPlus sends into a percentage', () => {
    expect(readTaxPct('0.05')).toBeCloseTo(5, 9);
    expect(readTaxPct('0')).toBe(0);
  });

  it('returns null rather than zero when the tax is unreadable', () => {
    // Zero tax is a fact about the token; unreadable is a fact about the
    // screen, and calling the second one "no tax" clears a trap.
    for (const value of [undefined, null, '', '  ', 'abc']) {
      expect(readTaxPct(value as never), String(value)).toBeNull();
    }
  });
});

describe('interpretGoPlusReport calls the traps dangerous', () => {
  it('names a honeypot outright', () => {
    const r = read({ is_honeypot: '1' });
    expect(r.verdict).toBe('danger');
    expect(r.flags.join(' ')).toContain('Honeypot');
  });

  it.each([
    ['cannot_sell_all', 'partial exit trap'],
    ['owner_change_balance', 'change balances'],
    ['selfdestruct', 'self-destruct'],
  ])('treats %s as dangerous on its own', (key, phrase) => {
    // Each of these alone hands the holder's money to someone else.
    const r = read({ [key]: '1' });
    expect(r.verdict).toBe('danger');
    expect(r.flags.join(' ').toLowerCase()).toContain(phrase.toLowerCase());
  });

  it('treats an unlocked pool as dangerous', () => {
    const r = read({ lp_holders: [{ is_locked: 0, percent: '0.9' }] });
    expect(r.verdict).toBe('danger');
    expect(r.lpLocked).toBe(false);
  });

  it('treats a punitive sell tax as a trap, not a fee', () => {
    const r = read({ sell_tax: String(GOPLUS_THRESHOLDS.PUNITIVE_TAX_PCT / 100) });
    expect(r.verdict).toBe('danger');
  });

  it('does not call an ordinary tax dangerous', () => {
    expect(read({ buy_tax: '0.03', sell_tax: '0.03' }).verdict).toBe('safe');
  });
});

describe('interpretGoPlusReport refuses to clear what it could not read', () => {
  it('reports unknown when the checks that matter are all missing', () => {
    // Not 'safe'. A payload that says nothing is not a clean bill of health.
    const r = interpretGoPlusReport('bsc', '0xabc', {} as never);
    expect(r.verdict).toBe('unknown');
    expect(r.lpLocked).toBeNull();
    expect(r.topHolderPct).toBeNull();
  });

  it('leaves lpLocked null when no LP holders are reported', () => {
    // Null, not false: "we don't know" must not read as "it can be pulled",
    // which would make every unreadable token dangerous and train the
    // reader to ignore the verdict.
    expect(read({ lp_holders: [] }).lpLocked).toBeNull();
    expect(read({ lp_holders: null }).lpLocked).toBeNull();
  });

  it('never claims a freeze authority was checked', () => {
    // EVM has no Solana-style freeze authority. Reporting `true` would
    // assert a check that never happened.
    expect(read().freezeAuthorityRevoked).toBeNull();
  });

  it('maps mintability to the mint-authority field only when it was readable', () => {
    expect(read({ is_mintable: '1' }).mintAuthorityRevoked).toBe(false);
    expect(read({ is_mintable: '0' }).mintAuthorityRevoked).toBe(true);
    expect(read({ is_mintable: undefined }).mintAuthorityRevoked).toBeNull();
  });
});

describe('interpretGoPlusReport is merely cautious about the rest', () => {
  it('clears a token where everything readable is fine', () => {
    expect(read().verdict).toBe('safe');
    expect(read().flags).toEqual([]);
  });

  it('flags unverified source without calling it a rug', () => {
    const r = read({ is_open_source: '0' });
    expect(r.verdict).toBe('caution');
    expect(r.flags.join(' ')).toContain('not verified');
  });

  it('flags a dominant holder', () => {
    const r = read({ holders: [{ percent: '0.35' }] });
    expect(r.verdict).toBe('caution');
    expect(r.topHolderPct).toBeCloseTo(35, 6);
  });

  it('flags many medium holders adding up', () => {
    // Ten wallets at 7% can rug as effectively as one at 70%.
    const r = read({ holders: Array.from({ length: 10 }, () => ({ percent: '0.07' })) });
    expect(r.verdict).toBe('caution');
  });
});

describe('chain routing', () => {
  it('covers the EVM chains it has ids for', () => {
    expect(toGoPlusChainId('bsc')).toBe('56');
    expect(toGoPlusChainId('ethereum')).toBe('1');
    expect(toGoPlusChainId('base')).toBe('8453');
  });

  it('does not claim a chain nobody verified', () => {
    // robinhood's EVM id is known (4663) but whether GoPlus indexes a chain
    // that new is not, and a screen that returns nothing is worse than no
    // screen because it looks like one ran.
    expect(toGoPlusChainId('robinhood')).toBeNull();
    expect(toGoPlusChainId('solana')).toBeNull();
  });

  it('reports unknown rather than throwing for a chain it does not cover', async () => {
    const source = new GoPlusSource({ logger });
    const report = await source.screen('solana', 'tok');
    expect(report.verdict).toBe('unknown');
    expect(report.flags[0]).toContain('not available');
  });
});

describe('CompositeSafetySource', () => {
  const stub = (name: string, chain: string): SafetySource => ({
    name,
    supportsChain: (c) => c === chain,
    screen: async (chainId: ChainId, tokenAddress: string): Promise<SafetyReport> => ({
      chainId,
      tokenAddress,
      verdict: 'safe',
      flags: [name],
      topHolderPct: null,
      lpLocked: null,
      mintAuthorityRevoked: null,
      freezeAuthorityRevoked: null,
      checkedAt: 0,
    }),
  });

  const composite = new CompositeSafetySource([stub('rugcheck', 'solana'), stub('goplus', 'bsc')], logger);

  it('sends each chain to the source that covers it', async () => {
    expect((await composite.screen('solana', 'tok')).flags).toEqual(['rugcheck']);
    expect((await composite.screen('bsc', '0xabc')).flags).toEqual(['goplus']);
  });

  it('covers a chain when any delegate does', () => {
    expect(composite.supportsChain('solana')).toBe(true);
    expect(composite.supportsChain('bsc')).toBe(true);
    expect(composite.supportsChain('robinhood')).toBe(false);
  });

  it('reports unknown, not safe, for a chain nothing covers', async () => {
    // The rule each source follows individually has to survive composition:
    // an uncovered chain must never come back clear.
    const report = await composite.screen('robinhood', '0xabc');
    expect(report.verdict).toBe('unknown');
    expect(report.flags[0]).toContain('robinhood');
  });
});
