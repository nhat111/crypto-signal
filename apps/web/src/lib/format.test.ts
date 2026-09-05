import { describe, expect, it } from 'vitest';
import { isStale } from './format';
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
