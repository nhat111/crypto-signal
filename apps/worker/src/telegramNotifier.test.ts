import { describe, expect, it } from 'vitest';
import type { SignalVerdict } from '@crypto-signal/db';
import type { Signal } from '@crypto-signal/signal-engine';
import type { HealthResult, RiskResult } from '@crypto-signal/health-engine';
import { formatAlertMessage } from './telegramNotifier.js';

const SIGNAL: Signal = {
  symbol: 'BTCUSDT',
  timeframe: '15m',
  signalType: 'SELLING_ABSORPTION_POSSIBLE',
  severity: 'MEDIUM',
  confidence: 62,
  timestamp: 0,
  reasons: ['Spot CVD rising while price is flat'],
  metrics: {},
};

const HEALTH = { score: 70, status: 'HEALTHY', components: {} } as unknown as HealthResult;
const RISK = { score: 40 } as unknown as RiskResult;

function verdict(overrides: Partial<SignalVerdict> = {}): SignalVerdict {
  return {
    signalType: 'SELLING_ABSORPTION_POSSIBLE',
    horizon: '4h',
    source: 'all',
    verdict: 'worse',
    deltaPp: -3,
    marginPp: 1.4,
    sampleCount: 10_655,
    hitPct: 51,
    baselinePct: 54,
    baselineSampleCount: 35_547,
    comparisons: 5,
    computedAt: 0,
    ...overrides,
  };
}

describe('formatAlertMessage', () => {
  it('warns when the recorded outcomes say this type is worse than doing nothing', () => {
    // The alert's default reading is "worth acting on". Sending a type the
    // evidence contradicts without saying so is the system measuring
    // something and not telling the person it measured it for.
    const text = formatAlertMessage(SIGNAL, HEALTH, RISK, verdict());
    expect(text).toContain('kém hơn mức nền');
    expect(text).toContain('10.655');
    expect(text).toContain('4h');
  });

  it('says nothing extra when the type beats the baseline', () => {
    // Deliberate asymmetry — a "beats the baseline" line attached to a
    // live alert reads as a recommendation to trade it.
    const text = formatAlertMessage(SIGNAL, HEALTH, RISK, verdict({ verdict: 'beats', deltaPp: 6 }));
    expect(text).not.toContain('mức nền');
  });

  it('says nothing extra when nothing has been concluded', () => {
    expect(formatAlertMessage(SIGNAL, HEALTH, RISK, verdict({ verdict: 'indistinguishable' }))).not.toContain(
      'mức nền',
    );
    expect(formatAlertMessage(SIGNAL, HEALTH, RISK)).not.toContain('mức nền');
  });

  it('still carries the signal itself when a warning is attached', () => {
    // A warning that displaced the reasons would be a regression, not a
    // feature: the explainability is the product.
    const text = formatAlertMessage(SIGNAL, HEALTH, RISK, verdict());
    expect(text).toContain('SELLING ABSORPTION POSSIBLE');
    expect(text).toContain('Spot CVD rising while price is flat');
    expect(text).toContain('Leverage Risk: 40/100');
  });
});
