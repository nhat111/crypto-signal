import type { MarketSnapshot } from '@crypto-signal/indicators';
import type { Signal } from '@crypto-signal/signal-engine';
import { clamp, type RiskWeights, type Thresholds } from '@crypto-signal/shared';
import type { RiskComponents, RiskResult } from './types.js';

/**
 * Leverage Risk is deliberately computed independently of Health (spec
 * §14) — it never reads the health components, only raw indicator values
 * plus which crowding/liquidation signals are currently active. A market
 * can be Health=70 / Risk=85 at the same time, exactly as spec §14 wants.
 */

function fundingExtremityRisk(fundingBias: MarketSnapshot['futures']['fundingBias']): number {
  switch (fundingBias) {
    case 'neutral':
      return 10;
    case 'elevated_positive':
    case 'elevated_negative':
      return 55;
    case 'extreme_positive':
    case 'extreme_negative':
      return 95;
  }
}

function oiVelocityRisk(velocityPctPerHour: number, thresholds: Thresholds): number {
  const magnitude = Math.abs(velocityPctPerHour);
  return clamp((magnitude / thresholds.oiStrongChangePct) * 100, 0, 100);
}

function basisExtremityRisk(basisPct: number, thresholds: Thresholds): number {
  return clamp((Math.abs(basisPct) / thresholds.basisElevatedPct) * 50, 0, 100);
}

function liquidationAnomalyRisk(ratio: number, thresholds: Thresholds): number {
  return clamp((ratio / thresholds.liquidationSpikeMult) * 40, 0, 100);
}

function volumeExtremityRisk(anomaly: MarketSnapshot['futures']['volumeAnomaly']): number {
  switch (anomaly) {
    case 'extreme':
      return 90;
    case 'abnormal':
      return 60;
    case 'elevated':
      return 30;
    default:
      return 10;
  }
}

function crowdingRisk(activeSignals: Signal[]): number {
  const crowdingSignals = activeSignals.filter((s) => s.signalType === 'LONG_CROWDING' || s.signalType === 'SHORT_CROWDING');
  if (crowdingSignals.length === 0) return 15;
  const hasHighOrExtreme = crowdingSignals.some((s) => s.severity === 'HIGH' || s.severity === 'EXTREME');
  return hasHighOrExtreme ? 90 : 60;
}

export function computeRiskComponents(
  snapshot: MarketSnapshot,
  activeSignals: Signal[],
  thresholds: Thresholds,
): RiskComponents {
  return {
    fundingExtremity: fundingExtremityRisk(snapshot.futures.fundingBias),
    oiVelocity: oiVelocityRisk(snapshot.futures.oiVelocityPctPerHour, thresholds),
    basisExtremity: basisExtremityRisk(snapshot.futures.basisPct, thresholds),
    liquidationAnomaly: liquidationAnomalyRisk(snapshot.futures.liquidationAnomalyRatio, thresholds),
    volumeExtremity: volumeExtremityRisk(snapshot.futures.volumeAnomaly),
    crowding: crowdingRisk(activeSignals),
  };
}

export function computeRiskScore(components: RiskComponents, weights: RiskWeights): number {
  const raw =
    components.fundingExtremity * weights.fundingExtremity +
    components.oiVelocity * weights.oiVelocity +
    components.basisExtremity * weights.basisExtremity +
    components.liquidationAnomaly * weights.liquidationAnomaly +
    components.volumeExtremity * weights.volumeExtremity +
    components.crowding * weights.crowding;
  return Math.round(clamp(raw / 100, 0, 100));
}

export function computeRisk(
  snapshot: MarketSnapshot,
  activeSignals: Signal[],
  thresholds: Thresholds,
  weights: RiskWeights,
): RiskResult {
  const components = computeRiskComponents(snapshot, activeSignals, thresholds);
  const score = computeRiskScore(components, weights);
  return { score, components };
}
