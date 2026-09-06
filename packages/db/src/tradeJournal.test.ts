import { describe, expect, it } from 'vitest';
import { computeTradePnl, isTradeSide, normalizeTradeSymbol } from './tradeJournal.js';

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

describe('computeTradePnl for spot', () => {
  it('prices a spot buy like a long', () => {
    // Buying and holding gains when price rises. Nothing about spot changes
    // the arithmetic — the side exists to record what was taken, not to
    // compute differently.
    expect(computeTradePnl('spot', 100, 110, 2).pnlPct).toBeCloseTo(10, 5);
    expect(computeTradePnl('spot', 100, 110, 2).pnlUsd).toBeCloseTo(20, 5);
    expect(computeTradePnl('spot', 100, 90, 2).pnlPct).toBeCloseTo(-10, 5);
  });

  it('agrees with a long exactly, so the two can never drift', () => {
    // If spot ever priced differently from a long, one of the two would be
    // wrong — and the journal would report a loss on a position that made
    // money.
    for (const exit of [1, 50, 99.9, 100, 100.1, 250, 1_000_000]) {
      expect(computeTradePnl('spot', 100, exit, 3)).toEqual(computeTradePnl('long', 100, exit, 3));
    }
  });

  it('is the only non-short side, so inversion is never the default', () => {
    // The direction test is written against 'short' rather than for 'long',
    // so a fourth side added later prices as a long instead of silently
    // inverting somebody's P&L.
    expect(computeTradePnl('spot', 100, 110, null).pnlPct).toBeGreaterThan(0);
    expect(computeTradePnl('long', 100, 110, null).pnlPct).toBeGreaterThan(0);
    expect(computeTradePnl('short', 100, 110, null).pnlPct).toBeLessThan(0);
  });
});

describe('isTradeSide', () => {
  it('accepts the three real sides', () => {
    expect(isTradeSide('spot')).toBe(true);
    expect(isTradeSide('long')).toBe(true);
    expect(isTradeSide('short')).toBe(true);
  });

  it('rejects anything else, including the near misses', () => {
    // It guards an HTTP body and a bot command, so the inputs are arbitrary.
    for (const bad of ['SPOT', 'Long', 'buy', 'sell', '', ' spot', null, undefined, 1, {}]) {
      expect(isTradeSide(bad), `${String(bad)} must be rejected`).toBe(false);
    }
  });
});

describe('normalizeTradeSymbol', () => {
  it('upper-cases a ticker so /close finds what /trade stored', () => {
    expect(normalizeTradeSymbol('btcusdt')).toBe('BTCUSDT');
    expect(normalizeTradeSymbol('  ethusdt  ')).toBe('ETHUSDT');
    expect(normalizeTradeSymbol('PONS')).toBe('PONS');
  });

  /**
   * The expensive one. Solana addresses are base58 and case-SENSITIVE:
   * upper-casing one yields a string that is a different address, or no
   * address at all. The journal would then hold a token that was never
   * bought, and the user could not paste it into an explorer.
   */
  it('leaves a Solana address exactly as typed', () => {
    const address = 'bdm98av7y3geqrhnn3f8uvcdlxngm7xbxxqzcgpbrub';
    expect(normalizeTradeSymbol(address)).toBe(address);
  });

  it('leaves an EVM address as typed, checksum casing intact', () => {
    const address = '0x198dBa421A7DB566a90dA5De7901ABe3443b1234';
    expect(normalizeTradeSymbol(address)).toBe(address);
  });

  it('still trims an address, since only the surrounding space is noise', () => {
    // A real address, not a short stand-in: anything 12 characters or
    // shorter is a ticker by this rule, and a fake "0xAbC123" would be
    // testing the wrong branch while looking like it tested this one.
    const pasted = '  0x198dBa421A7DB566a90dA5De7901ABe3443b1234  ';
    expect(normalizeTradeSymbol(pasted)).toBe(pasted.trim());
  });

  it('splits on shape rather than on chain, and the boundary is the risky part', () => {
    // 12 alphanumeric characters is the longest thing treated as a ticker.
    // One more and it is left alone — an address is never this short, and a
    // ticker is never this long.
    expect(normalizeTradeSymbol('abcdefghijkl')).toBe('ABCDEFGHIJKL');
    expect(normalizeTradeSymbol('abcdefghijklm')).toBe('abcdefghijklm');
    // Anything non-alphanumeric is an address or a pair notation, not a
    // ticker to fold.
    expect(normalizeTradeSymbol('btc-usdt')).toBe('btc-usdt');
    expect(normalizeTradeSymbol('')).toBe('');
  });
});
