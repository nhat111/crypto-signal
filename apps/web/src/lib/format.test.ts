import { describe, expect, it } from 'vitest';
import { isStale, formatTokenPrice } from './format';
import type { Timeframe } from './types';

describe('isStale', () => {
  const now = 1_800_000_000_000;
  const MIN = 60_000;

  it('leaves a fresh snapshot alone', () => {
    expect(isStale(now - MIN, '5m', now)).toBe(false);
    expect(isStale(now - 14 * MIN, '5m', now)).toBe(false);
  });

  it('flags a fast frame past the same window /status uses', () => {
    // The two pages must not disagree about which symbols are keeping up.
    expect(isStale(now - 16 * MIN, '5m', now)).toBe(true);
    expect(isStale(now - 15 * 60 * MIN, '5m', now)).toBe(true);
  });

  it('does not brand a slow frame stale for simply being slow', () => {
    // The regression this scaling exists to prevent: a 4h snapshot is
    // legitimately hours old for most of its life, so a flat fifteen
    // minutes would put a "dữ liệu cũ" banner on every card, permanently,
    // on a perfectly healthy feed.
    expect(isStale(now - 3 * 60 * MIN, '4h', now)).toBe(false);
    expect(isStale(now - 90 * MIN, '1h', now)).toBe(false);
  });

  it('still flags a slow frame that missed its close', () => {
    // Half a period of slack, not unlimited: one skipped 4h candle shows.
    expect(isStale(now - 7 * 60 * MIN, '4h', now)).toBe(true);
    expect(isStale(now - 2 * 60 * MIN, '1h', now)).toBe(true);
  });

  it('falls back to the floor for a frame it does not know', () => {
    // The API can serve a frame added after this build shipped. Erring
    // toward flagging is the safe direction; silently disabling the banner
    // is not.
    expect(isStale(now - 16 * MIN, '2h' as Timeframe, now)).toBe(true);
    expect(isStale(now - 5 * MIN, '2h' as Timeframe, now)).toBe(false);
  });

  it('says nothing when there is no timestamp to judge', () => {
    // Absent is not stale: a card with no snapshot at all is a different
    // state, and claiming its data is old would be inventing a history.
    expect(isStale(null, '5m', now)).toBe(false);
    expect(isStale(undefined, '5m', now)).toBe(false);
  });
});

describe('formatTokenPrice', () => {
  it('shows a normal price to the cent, like everything else', () => {
    expect(formatTokenPrice(78_000)).toBe('$78,000.00');
    expect(formatTokenPrice(1)).toBe('$1.00');
    expect(formatTokenPrice(4_123.456)).toBe('$4,123.46');
  });

  /**
   * The bug this exists for. A gem bought at $0.00042 rendered as "$0.00"
   * in the journal, which does not read as rounding — it reads as a
   * recorded zero, right next to the P&L the user came to check.
   */
  it('keeps a sub-cent price readable instead of rounding it to zero', () => {
    expect(formatTokenPrice(0.00042)).not.toBe('$0.00');
    expect(formatTokenPrice(0.00042)).toContain('0.00042');
    expect(formatTokenPrice(0.000000123)).toContain('123');
  });

  it('uses more decimals only where cents would lose the number', () => {
    expect(formatTokenPrice(0.5)).toBe('$0.5');
    expect(formatTokenPrice(0.1234)).toBe('$0.1234');
  });

  it('prints an exact zero as a price, not as significant digits', () => {
    // Zero has no significant digits, so the small-value branch would
    // render "$0.00000" — a number that looks measured rather than nil.
    expect(formatTokenPrice(0)).toBe('$0.00');
  });

  it('keeps the sign on a negative', () => {
    expect(formatTokenPrice(-0.00042)).toContain('-');
    expect(formatTokenPrice(-12.5)).toBe('-$12.50');
  });

  it('says nothing rather than zero when there is no price', () => {
    expect(formatTokenPrice(null)).toBe('—');
    expect(formatTokenPrice(undefined)).toBe('—');
    expect(formatTokenPrice(Number.NaN)).toBe('—');
  });
});
