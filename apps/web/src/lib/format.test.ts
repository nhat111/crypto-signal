import { describe, expect, it } from 'vitest';
import { isStale } from './format';

describe('isStale', () => {
  const now = 1_800_000_000_000;

  it('leaves a fresh snapshot alone', () => {
    expect(isStale(now - 60_000, now)).toBe(false);
    expect(isStale(now - 14 * 60_000, now)).toBe(false);
  });

  it('flags anything past the same window /status uses', () => {
    // The two pages must not disagree about which symbols are keeping up.
    expect(isStale(now - 16 * 60_000, now)).toBe(true);
    expect(isStale(now - 15 * 60 * 60_000, now)).toBe(true);
  });

  it('says nothing when there is no timestamp to judge', () => {
    // Absent is not stale: a card with no snapshot at all is a different
    // state, and claiming its data is old would be inventing a history.
    expect(isStale(null, now)).toBe(false);
    expect(isStale(undefined, now)).toBe(false);
  });
});
