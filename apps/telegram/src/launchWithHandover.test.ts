import { describe, expect, it, vi } from 'vitest';
import { isConflict, launchWithHandover } from './launchWithHandover.js';

const conflict = () => Object.assign(new Error('409: Conflict'), { response: { ok: false, error_code: 409 } });
const logger = { warn: () => {}, error: () => {} };
const noWait = async () => {};

describe('isConflict', () => {
  it('recognises Telegram\'s "another getUpdates is running"', () => {
    expect(isConflict(conflict())).toBe(true);
  });

  it('does not mistake other failures for it', () => {
    expect(isConflict(Object.assign(new Error('unauthorized'), { response: { error_code: 401 } }))).toBe(false);
    expect(isConflict(new Error('network down'))).toBe(false);
    expect(isConflict(null)).toBe(false);
    expect(isConflict('409')).toBe(false);
  });
});

describe('launchWithHandover', () => {
  it('starts on the first try when nothing else holds the token', async () => {
    const launch = vi.fn(async () => {});
    await launchWithHandover({ launch, logger, wait: noWait });
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('waits out the container it is replacing', async () => {
    // The deploy case: the old container is still draining, so the first
    // attempts conflict and the third succeeds.
    let calls = 0;
    const launch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw conflict();
    });
    await launchWithHandover({ launch, logger, wait: noWait });
    expect(launch).toHaveBeenCalledTimes(3);
  });

  it('fails fast on anything that is not a conflict', async () => {
    // A bad token must not spend a minute pretending to hand over.
    const launch = vi.fn(async () => {
      throw Object.assign(new Error('unauthorized'), { response: { error_code: 401 } });
    });
    await expect(launchWithHandover({ launch, logger, wait: noWait })).rejects.toThrow('unauthorized');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('gives up eventually rather than hiding a permanent second instance', async () => {
    const launch = vi.fn(async () => {
      throw conflict();
    });
    await expect(launchWithHandover({ launch, logger, wait: noWait, attempts: 4 })).rejects.toThrow();
    expect(launch).toHaveBeenCalledTimes(4);
  });

  it('backs off longer each time instead of hammering', async () => {
    const waits: number[] = [];
    const launch = vi.fn(async () => {
      throw conflict();
    });
    await expect(
      launchWithHandover({ launch, logger, wait: async (ms) => void waits.push(ms), attempts: 4 }),
    ).rejects.toThrow();
    expect(waits).toEqual([5000, 10000, 15000]);
  });
});
