import { describe, expect, it } from 'vitest';
import type { LastSignalAlert } from '@crypto-signal/db';
import type { Signal } from '@crypto-signal/signal-engine';
import { shouldSendAlert } from './alerting.js';

function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    signalType: 'LEVERAGED_RALLY',
    severity: 'MEDIUM',
    confidence: 60,
    timestamp: 0,
    reasons: [],
    metrics: {},
    ...overrides,
  };
}

describe('shouldSendAlert (spec §21 cooldown)', () => {
  const now = 1_700_000_000_000;

  it('always sends when there is no prior alert', () => {
    expect(shouldSendAlert(signal(), undefined, 30, 15, now)).toBe(true);
  });

  it('suppresses a repeat of the same signal within the cooldown window', () => {
    const last: LastSignalAlert = { severity: 'MEDIUM', confidence: 60, sentAt: now - 5 * 60_000 };
    expect(shouldSendAlert(signal(), last, 30, 15, now)).toBe(false);
  });

  it('sends again once the cooldown window has fully elapsed', () => {
    const last: LastSignalAlert = { severity: 'MEDIUM', confidence: 60, sentAt: now - 31 * 60_000 };
    expect(shouldSendAlert(signal(), last, 30, 15, now)).toBe(true);
  });

  it('re-sends early if severity increased, even inside the cooldown', () => {
    const last: LastSignalAlert = { severity: 'MEDIUM', confidence: 60, sentAt: now - 5 * 60_000 };
    expect(shouldSendAlert(signal({ severity: 'HIGH' }), last, 30, 15, now)).toBe(true);
  });

  it('does not re-send early on a severity decrease', () => {
    const last: LastSignalAlert = { severity: 'HIGH', confidence: 60, sentAt: now - 5 * 60_000 };
    expect(shouldSendAlert(signal({ severity: 'MEDIUM' }), last, 30, 15, now)).toBe(false);
  });

  it('re-sends early if confidence changed by at least the configured delta', () => {
    const last: LastSignalAlert = { severity: 'MEDIUM', confidence: 40, sentAt: now - 5 * 60_000 };
    expect(shouldSendAlert(signal({ confidence: 60 }), last, 30, 15, now)).toBe(true);
  });

  it('does not re-send for a small confidence change under the delta', () => {
    const last: LastSignalAlert = { severity: 'MEDIUM', confidence: 55, sentAt: now - 5 * 60_000 };
    expect(shouldSendAlert(signal({ confidence: 60 }), last, 30, 15, now)).toBe(false);
  });
});
