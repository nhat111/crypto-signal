import { describe, expect, it } from 'vitest';
import type { Thresholds } from '@crypto-signal/shared';
import { classifyFunding } from './funding.js';

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

describe('classifyFunding — spec §9 exact example thresholds', () => {
  it('is neutral inside the band', () => {
    expect(classifyFunding(0.00005, thresholds)).toBe('neutral'); // 0.005%
  });

  it('is elevated_positive at +0.01%', () => {
    expect(classifyFunding(0.0001, thresholds)).toBe('elevated_positive');
  });

  it('is extreme_positive at +0.03%', () => {
    expect(classifyFunding(0.0003, thresholds)).toBe('extreme_positive');
  });

  it('is elevated_negative at -0.01%', () => {
    expect(classifyFunding(-0.0001, thresholds)).toBe('elevated_negative');
  });

  it('is extreme_negative at -0.03%', () => {
    expect(classifyFunding(-0.0003, thresholds)).toBe('extreme_negative');
  });
});
