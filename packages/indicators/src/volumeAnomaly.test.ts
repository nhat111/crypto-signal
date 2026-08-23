import { describe, expect, it } from 'vitest';
import type { Thresholds } from '@crypto-signal/shared';
import { classifyVolumeAnomaly, computeVolumeRatio, rollingAverage } from './volumeAnomaly.js';

const thresholds: Thresholds = {
  priceChangePct: 0.3,
  cvdSkewRatio: 0.15,
  oiChangePct: 2,
  oiStrongChangePct: 5,
  fundingElevatedPct: 0.01,
  fundingExtremePct: 0.03,
  volumeElevatedMult: 1.5,
  volumeAbnormalMult: 2,
  volumeExtremeMult: 3,
  liquidationSpikeMult: 3,
  basisElevatedPct: 0.1,
};

describe('volume anomaly — spec §12 exact example multipliers', () => {
  it('rollingAverage of empty history is 0, not NaN', () => {
    expect(rollingAverage([])).toBe(0);
  });

  it('classifies below 1.5x as normal', () => {
    expect(classifyVolumeAnomaly(computeVolumeRatio(140, 100), thresholds)).toBe('normal');
  });

  it('classifies 1.5x-2x as elevated', () => {
    expect(classifyVolumeAnomaly(1.6, thresholds)).toBe('elevated');
  });

  it('classifies 2x-3x as abnormal', () => {
    expect(classifyVolumeAnomaly(2.5, thresholds)).toBe('abnormal');
  });

  it('classifies 3x+ as extreme', () => {
    expect(classifyVolumeAnomaly(3.1, thresholds)).toBe('extreme');
  });

  it('treats zero average volume as ratio 1 (normal), not a division error', () => {
    expect(computeVolumeRatio(500, 0)).toBe(1);
  });
});
