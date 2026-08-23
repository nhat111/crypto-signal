import { describe, expect, it } from 'vitest';
import { computeBackoffDelay, type BackoffOptions } from './backoff.js';

const noJitter: BackoffOptions = { baseDelayMs: 1000, maxDelayMs: 30_000, jitter: () => 1 };

describe('computeBackoffDelay (WS reconnect policy)', () => {
  it('grows exponentially with attempt number', () => {
    expect(computeBackoffDelay(1, noJitter)).toBe(1000);
    expect(computeBackoffDelay(2, noJitter)).toBe(2000);
    expect(computeBackoffDelay(3, noJitter)).toBe(4000);
    expect(computeBackoffDelay(4, noJitter)).toBe(8000);
  });

  it('caps at maxDelayMs no matter how many attempts', () => {
    expect(computeBackoffDelay(20, noJitter)).toBe(30_000);
  });

  it('applies full jitter between 50% and 100% of the exponential value', () => {
    const lowJitter = computeBackoffDelay(3, { baseDelayMs: 1000, maxDelayMs: 30_000, jitter: () => 0 });
    const highJitter = computeBackoffDelay(3, { baseDelayMs: 1000, maxDelayMs: 30_000, jitter: () => 1 });
    expect(lowJitter).toBe(2000); // 4000 * 0.5
    expect(highJitter).toBe(4000); // 4000 * 1.0
  });

  it('never produces a negative or zero delay for attempt 1', () => {
    const delay = computeBackoffDelay(1);
    expect(delay).toBeGreaterThan(0);
  });
});
