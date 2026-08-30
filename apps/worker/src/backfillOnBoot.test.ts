import { describe, expect, it } from 'vitest';
import { parseBackfillDays, parseBackfillForce, shouldRunBackfill } from './backfillOnBoot.js';

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

describe('parseBackfillForce', () => {
  it('is off unless explicitly asked for', () => {
    expect(parseBackfillForce(undefined)).toBe(false);
    expect(parseBackfillForce('')).toBe(false);
    expect(parseBackfillForce('0')).toBe(false);
    expect(parseBackfillForce('false')).toBe(false);
    // Not a truthy-string check: leaving junk in the variable must not
    // turn every restart into a fresh 30-day replay.
    expect(parseBackfillForce('maybe')).toBe(false);
  });

  it('accepts the forms someone actually types into Railway', () => {
    expect(parseBackfillForce('1')).toBe(true);
    expect(parseBackfillForce('true')).toBe(true);
    expect(parseBackfillForce('TRUE')).toBe(true);
    expect(parseBackfillForce(' yes ')).toBe(true);
  });
});

describe('shouldRunBackfill — force', () => {
  const now = 1_800_000_000_000;

  it('overrides a cooldown the operator cannot otherwise clear', () => {
    // The cooldown reads a success an older build could record for a run
    // that scored nothing, and there is no shell on this platform to
    // reset it from.
    expect(shouldRunBackfill(now - 60_000, now, true)).toBe(true);
  });

  it('still refuses without the flag', () => {
    expect(shouldRunBackfill(now - 60_000, now, false)).toBe(false);
  });
});
