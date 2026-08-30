import { describe, expect, it } from 'vitest';
import { parseBackfillDays, shouldRunBackfill } from './backfillOnBoot.js';

const HOUR = 60 * 60_000;

describe('parseBackfillDays', () => {
  it('is off when the variable is absent', () => {
    expect(parseBackfillDays(undefined)).toBeNull();
    expect(parseBackfillDays('')).toBeNull();
  });

  it('reads a day count', () => {
    expect(parseBackfillDays('30')).toBe(30);
    expect(parseBackfillDays('7')).toBe(7);
  });

  it('refuses junk rather than guessing a window', () => {
    // A typo must not silently become "replay some arbitrary period".
    expect(parseBackfillDays('abc')).toBeNull();
    expect(parseBackfillDays('0')).toBeNull();
    expect(parseBackfillDays('-5')).toBeNull();
  });
});

describe('shouldRunBackfill', () => {
  const now = 1_800_000_000_000;

  it('runs when it has never run', () => {
    expect(shouldRunBackfill(null, now)).toBe(true);
    expect(shouldRunBackfill(undefined, now)).toBe(true);
  });

  it('does not re-run on a restart minutes later', () => {
    // The failure this exists to prevent: a crash-looping container firing
    // a fresh 30-day replay, and hundreds of upstream requests, every time
    // it comes back up.
    expect(shouldRunBackfill(now - 5 * 60_000, now)).toBe(false);
  });

  it('still refuses several hours later', () => {
    expect(shouldRunBackfill(now - 6 * HOUR, now)).toBe(false);
  });

  it('runs again once a day has effectively passed', () => {
    // So the variable can be left set: it becomes "at most once a day"
    // rather than something that must be removed to be safe.
    expect(shouldRunBackfill(now - 21 * HOUR, now)).toBe(true);
  });
});
