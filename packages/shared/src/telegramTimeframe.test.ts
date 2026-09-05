import { describe, expect, it } from 'vitest';
import { isEnabledFlag, pickDefaultTimeframe } from './config.js';
import type { Timeframe } from './types.js';

/**
 * Which timeframe the bot answers on when nobody names one.
 *
 * It was 15m, hard-coded — the noisiest frame collected, and not the one
 * the performance page measures outcomes at. For someone buying spot the
 * reading flipped several times inside a single decision.
 */
describe('pickDefaultTimeframe', () => {
  const collected = ['5m', '15m', '1h', '4h'] as Timeframe[];

  it('uses the configured frame when it is actually collected', () => {
    expect(pickDefaultTimeframe('4h', collected)).toBe('4h');
    expect(pickDefaultTimeframe('1h', collected)).toBe('1h');
  });

  it('falls back to the longest collected frame rather than answering with nothing', () => {
    // A default nobody collects filters every row out, and an empty
    // /status reads as a dead collector — a much more expensive wrong
    // conclusion than "that env var has a typo".
    expect(pickDefaultTimeframe('4h', ['5m', '15m', '1h'] as Timeframe[])).toBe('1h');
    expect(pickDefaultTimeframe('1d', collected)).toBe('4h');
    expect(pickDefaultTimeframe('', collected)).toBe('4h');
  });

  it('never returns a frame outside what is collected', () => {
    for (const configured of ['4h', '1d', 'nonsense', '']) {
      for (const list of [collected, ['15m'] as Timeframe[], ['5m', '1h'] as Timeframe[]]) {
        expect(list).toContain(pickDefaultTimeframe(configured, list));
      }
    }
  });
});

describe('isEnabledFlag', () => {
  it('accepts every spelling of on somebody might type into a dashboard', () => {
    for (const on of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ', 'anything']) {
      expect(isEnabledFlag(on), on).toBe(true);
    }
  });

  it('treats unset and every spelling of off as off', () => {
    // Unset must be off: this switch sends real messages on every boot.
    for (const off of ['', '   ', '0', 'false', 'FALSE', 'no', 'off']) {
      expect(isEnabledFlag(off), JSON.stringify(off)).toBe(false);
    }
  });
});
