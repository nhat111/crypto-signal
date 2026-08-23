import type { MarketSnapshot } from '@crypto-signal/indicators';
import type { Signal, SignalType } from '@crypto-signal/signal-engine';
import { clamp, type HealthWeights, type Thresholds } from '@crypto-signal/shared';
import type { HealthComponents, HealthResult, HealthStatus } from './types.js';

/**
 * Every component-scoring function below is our own heuristic, built on
 * top of the deterministic indicator numbers (never on AI/price-color) —
 * documented as a design decision in ASSUMPTIONS.md §7, since the spec
 * names the eight components (§13) but not their internal formulas.
 */

function directionalAgreementScore(changePct: number, skewRatio: number, threshold: number): number {
  if (Math.abs(changePct) < threshold) {
    return clamp(50 + (skewRatio / threshold) * 20, 0, 100);
  }
  const agreement = Math.sign(changePct) * skewRatio;
  return clamp(50 + (agreement / threshold) * 40, 0, 100);
}

function futuresPositioningScore(spotSkew: number, futuresSkew: number, threshold: number): number {
  const aligned = spotSkew * futuresSkew;
  const normalized = aligned / (threshold ** 2 || 1);
  return clamp(50 + normalized * 25, 0, 100);
}

function openInterestScore(oiChangePct: number, thresholds: Thresholds): number {
  const magnitude = Math.abs(oiChangePct);
  if (magnitude <= thresholds.oiChangePct) return 80;
  const span = thresholds.oiStrongChangePct - thresholds.oiChangePct || 1;
  const over = (magnitude - thresholds.oiChangePct) / span;
  return clamp(80 - over * 60, 10, 80);
}

function fundingScore(fundingBias: MarketSnapshot['futures']['fundingBias']): number {
  switch (fundingBias) {
    case 'neutral':
      return 90;
    case 'elevated_positive':
    case 'elevated_negative':
      return 55;
    case 'extreme_positive':
    case 'extreme_negative':
      return 20;
  }
}

function liquidationScore(spike: boolean, ratio: number, thresholds: Thresholds): number {
  if (!spike) return 85;
  const over = clamp((ratio - thresholds.liquidationSpikeMult) / thresholds.liquidationSpikeMult, 0, 2);
  return clamp(85 - over * 50, 10, 85);
}

function volumeScore(anomaly: MarketSnapshot['spot']['volumeAnomaly'], ratio: number): number {
  if (anomaly === 'extreme') return 30;
  if (anomaly === 'abnormal') return 55;
  if (anomaly === 'elevated') return 80;
  return ratio < 0.5 ? 50 : 90;
}

const NEGATIVE_SIGNAL_TYPES: readonly SignalType[] = [
  'LEVERAGED_RALLY',
  'LONG_CROWDING',
  'SHORT_CROWDING',
  'LONG_LIQUIDATION',
  'SHORT_LIQUIDATION',
];

function divergenceScore(activeSignals: Signal[]): number {
  const hasNegative = activeSignals.some((s) => NEGATIVE_SIGNAL_TYPES.includes(s.signalType));
  if (hasNegative) return 25;
  const hasPositive = activeSignals.some((s) => s.signalType === 'SPOT_CONFIRMED_RALLY');
  if (hasPositive) return 90;
  return 65;
}

export function computeHealthComponents(
  snapshot: MarketSnapshot,
  activeSignals: Signal[],
  thresholds: Thresholds,
): HealthComponents {
  return {
    spotConfirmation: directionalAgreementScore(snapshot.price.changePct, snapshot.spot.cvdSkewRatio, thresholds.cvdSkewRatio),
    futuresPositioning: futuresPositioningScore(snapshot.spot.cvdSkewRatio, snapshot.futures.cvdSkewRatio, thresholds.cvdSkewRatio),
    openInterest: openInterestScore(snapshot.futures.oiChangePct, thresholds),
    funding: fundingScore(snapshot.futures.fundingBias),
    liquidation: liquidationScore(snapshot.futures.liquidationSpike, snapshot.futures.liquidationAnomalyRatio, thresholds),
    volume: volumeScore(snapshot.spot.volumeAnomaly, snapshot.spot.volumeRatio),
    priceStructure: snapshot.price.structureScore,
    divergence: divergenceScore(activeSignals),
  };
}

/** Weights (spec §13) sum to 100, so this weighted sum is already 0-100. */
export function computeHealthScore(components: HealthComponents, weights: HealthWeights): number {
  const raw =
    components.spotConfirmation * weights.spotConfirmation +
    components.futuresPositioning * weights.futuresPositioning +
    components.openInterest * weights.openInterest +
    components.funding * weights.funding +
    components.liquidation * weights.liquidation +
    components.volume * weights.volume +
    components.priceStructure * weights.priceStructure +
    components.divergence * weights.divergence;
  return Math.round(clamp(raw / 100, 0, 100));
}

/** Bucket boundaries are spec §2's exact numbers, not invented. */
export function classifyHealth(score: number): HealthStatus {
  if (score >= 80) return 'VERY_HEALTHY';
  if (score >= 65) return 'HEALTHY';
  if (score >= 50) return 'NEUTRAL';
  if (score >= 35) return 'WEAK';
  return 'VERY_WEAK';
}

export function computeHealth(
  snapshot: MarketSnapshot,
  activeSignals: Signal[],
  thresholds: Thresholds,
  weights: HealthWeights,
): HealthResult {
  const components = computeHealthComponents(snapshot, activeSignals, thresholds);
  const score = computeHealthScore(components, weights);
  return { score, status: classifyHealth(score), components };
}
