import type { ConfidenceWeights } from '@crypto-signal/shared';
import { clamp } from '@crypto-signal/shared';

export interface ConfidenceInputs {
  dataQualityScore: number;
  confirmationScore: number;
  magnitudeScore: number;
  historicalScore: number;
}

/**
 * Spec §30 formula, verbatim weighting:
 * confidence = 0.25*data_quality + 0.30*confirmation + 0.25*magnitude + 0.20*historical
 */
export function computeConfidence(inputs: ConfidenceInputs, weights: ConfidenceWeights): number {
  const raw =
    inputs.dataQualityScore * weights.dataQuality +
    inputs.confirmationScore * weights.confirmation +
    inputs.magnitudeScore * weights.magnitude +
    inputs.historicalScore * weights.historical;
  return Math.round(clamp(raw, 0, 100));
}

export function confirmationFromCount(confirmed: number, total: number): number {
  if (total <= 0) return 50;
  return Math.round(clamp((confirmed / total) * 100, 0, 100));
}

/**
 * Scores how far a metric sits past the threshold that triggered the rule:
 * ~20 right at the threshold, 100 at `capMultiple`x the threshold. Never 0
 * for a rule that actually fired — being right at the line is still a real
 * (if weak) signal, not a non-signal (ASSUMPTIONS.md §9 discusses defaults;
 * this curve is the concrete implementation of "magnitude of divergence"
 * from spec §30).
 */
export function magnitudeFromRatio(value: number, threshold: number, capMultiple = 3): number {
  if (threshold === 0) return 50;
  const ratio = Math.abs(value) / Math.abs(threshold);
  const normalized = clamp((ratio - 1) / (capMultiple - 1), 0, 1);
  return Math.round(20 + normalized * 80);
}

export const DEFAULT_HISTORICAL_SCORE = 50;
