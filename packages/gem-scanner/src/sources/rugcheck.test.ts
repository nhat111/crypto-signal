import { describe, expect, it } from 'vitest';
import { interpretRugCheckReport } from './rugcheck.js';

/**
 * The safety interpreter is the single most consequential piece of the gem
 * scanner: calling a rug "safe" costs a user everything. These tests pin
 * the rule that absence of evidence is never evidence of safety.
 */
describe('interpretRugCheckReport', () => {
  it('reports safe only when the checks actually came back clean', () => {
    const report = interpretRugCheckReport('solana', 'tok1', {
      token: { mintAuthority: null, freezeAuthority: null },
      topHolders: [{ pct: 5 }, { pct: 4 }],
      markets: [{ lp: { lpLockedPct: 100 } }],
      risks: [],
    });

    expect(report.verdict).toBe('safe');
    expect(report.mintAuthorityRevoked).toBe(true);
    expect(report.lpLocked).toBe(true);
  });

  it('reports unknown — never safe — when nothing could be confirmed', () => {
    const report = interpretRugCheckReport('solana', 'tok1', {});
    expect(report.verdict).toBe('unknown');
    expect(report.mintAuthorityRevoked).toBeNull();
    expect(report.freezeAuthorityRevoked).toBeNull();
    expect(report.lpLocked).toBeNull();
  });

  it('treats a live mint authority as outright dangerous — supply can be inflated', () => {
    const report = interpretRugCheckReport('solana', 'tok1', {
      token: { mintAuthority: 'SomeAuthorityAddress', freezeAuthority: null },
      markets: [{ lp: { lpLockedPct: 100 } }],
    });
    expect(report.verdict).toBe('danger');
    expect(report.mintAuthorityRevoked).toBe(false);
    expect(report.flags.join(' ')).toContain('Mint authority');
  });

  it('treats unlocked liquidity as dangerous — it can be pulled', () => {
    const report = interpretRugCheckReport('solana', 'tok1', {
      token: { mintAuthority: null, freezeAuthority: null },
      markets: [{ lp: { lpLockedPct: 5 } }],
    });
    expect(report.verdict).toBe('danger');
    expect(report.lpLocked).toBe(false);
  });

  it('downgrades to caution when ownership is concentrated even if the authorities are revoked', () => {
    const report = interpretRugCheckReport('solana', 'tok1', {
      token: { mintAuthority: null, freezeAuthority: null },
      markets: [{ lp: { lpLockedPct: 100 } }],
      topHolders: [{ pct: 45 }, { pct: 5 }],
    });
    expect(report.verdict).toBe('caution');
    expect(report.topHolderPct).toBe(45);
    expect(report.flags.join(' ')).toContain('45.0%');
  });

  it('surfaces upstream risk descriptions as flags', () => {
    const report = interpretRugCheckReport('solana', 'tok1', {
      token: { mintAuthority: null, freezeAuthority: null },
      markets: [{ lp: { lpLockedPct: 100 } }],
      risks: [{ name: 'Low liquidity', description: 'Liquidity is very low', level: 'warn' }],
    });
    expect(report.verdict).toBe('caution');
    expect(report.flags).toContain('Liquidity is very low');
  });

  it('ignores informational risks that are not warnings', () => {
    const report = interpretRugCheckReport('solana', 'tok1', {
      token: { mintAuthority: null, freezeAuthority: null },
      markets: [{ lp: { lpLockedPct: 100 } }],
      topHolders: [{ pct: 3 }],
      risks: [{ name: 'Note', description: 'Nothing important', level: 'info' }],
    });
    expect(report.verdict).toBe('safe');
    expect(report.flags).toHaveLength(0);
  });
});
