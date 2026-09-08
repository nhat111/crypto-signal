import { describe, expect, it, vi } from 'vitest';
import { MAX_RETRY_WAIT_SECONDS, retryAfterSeconds, retryOn429 } from './retryAfter.js';

const rateLimited = (retry_after: number) =>
  Object.assign(new Error('429: Too Many Requests'), { response: { ok: false, error_code: 429, parameters: { retry_after } } });

const logger = { warn: () => {} };
const noWait = async () => {};

describe('retryAfterSeconds', () => {
  it('reads the wait Telegram asked for', () => {
    expect(retryAfterSeconds(rateLimited(7))).toBe(7);
  });

  it('returns null for anything that is not a rate limit', () => {
    expect(retryAfterSeconds(Object.assign(new Error('x'), { response: { error_code: 400 } }))).toBeNull();
    expect(retryAfterSeconds(new Error('network'))).toBeNull();
    expect(retryAfterSeconds(null)).toBeNull();
  });

  it('returns null when a 429 carries no usable wait', () => {
    // Guessing an interval here would be the thing that earns another 429.
    expect(retryAfterSeconds(Object.assign(new Error('x'), { response: { error_code: 429 } }))).toBeNull();
    expect(
      retryAfterSeconds(Object.assign(new Error('x'), { response: { error_code: 429, parameters: { retry_after: 'soon' } } })),
    ).toBeNull();
  });
});

describe('retryOn429', () => {
  it('reports success without retrying when the call works', async () => {
    const attempt = vi.fn(async () => {});
    expect(await retryOn429({ attempt, logger, wait: noWait })).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('waits exactly as long as Telegram asked, then succeeds', async () => {
    const waits: number[] = [];
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw rateLimited(3);
    });
    expect(await retryOn429({ attempt, logger, wait: async (ms) => void waits.push(ms) })).toBe(true);
    expect(waits).toEqual([3000]);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('does not hold up the boot for a long rate limit', async () => {
    // A burst of deploys can earn a wait measured in minutes. The menu is
    // worth seconds; the bot being absent is not worth any of them.
    const attempt = vi.fn(async () => {
      throw rateLimited(MAX_RETRY_WAIT_SECONDS + 1);
    });
    expect(await retryOn429({ attempt, logger, wait: noWait })).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry an error that is not a rate limit', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('bad request');
    });
    expect(await retryOn429({ attempt, logger, wait: noWait })).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('never throws — a stale menu must not take the bot down', async () => {
    const attempt = vi.fn(async () => {
      throw rateLimited(1);
    });
    await expect(retryOn429({ attempt, logger, wait: noWait })).resolves.toBe(false);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
