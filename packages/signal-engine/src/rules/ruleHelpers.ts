import type { MarketSnapshot } from '@crypto-signal/indicators';
import type { ConfidenceWeights } from '@crypto-signal/shared';
import { computeConfidence, confirmationFromCount, magnitudeFromRatio, DEFAULT_HISTORICAL_SCORE } from '../confidence.js';
import { escalateSeverity } from '../severity.js';
import type { Severity, Signal, SignalType } from '../types.js';

export interface BuildSignalParams {
  snapshot: MarketSnapshot;
  signalType: SignalType;
  baseSeverity: Severity;
  /** Extra severity steps, e.g. +1 when funding is also elevated (spec §16). */
  severitySteps?: number;
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
  /** How many of the rule's *optional* confirming checks (beyond the core trigger) actually held. */
  confirmed: number;
  totalChecks: number;
  magnitudeValue: number;
  magnitudeThreshold: number;
  confidenceWeights: ConfidenceWeights;
  historicalScore: number | undefined;
  /** Caps confidence for "possible, not confirmed" rules (spec explicitly forbids overclaiming for SHORT_COVERING_POSSIBLE / SELLING_ABSORPTION_POSSIBLE). */
  confidenceCap?: number;
}

export function buildSignal(params: BuildSignalParams): Signal {
  const severity = escalateSeverity(params.baseSeverity, params.severitySteps ?? 0);
  const confirmationScore = confirmationFromCount(params.confirmed, params.totalChecks);
  const magnitudeScore = magnitudeFromRatio(params.magnitudeValue, params.magnitudeThreshold);
  const dataQualityScore = params.snapshot.dataQuality.score;
  const historicalScore = params.historicalScore ?? DEFAULT_HISTORICAL_SCORE;

  let confidence = computeConfidence(
    { dataQualityScore, confirmationScore, magnitudeScore, historicalScore },
    params.confidenceWeights,
  );
  if (params.confidenceCap !== undefined) confidence = Math.min(confidence, params.confidenceCap);

  return {
    symbol: params.snapshot.symbol,
    timeframe: params.snapshot.timeframe,
    signalType: params.signalType,
    severity,
    confidence,
    timestamp: params.snapshot.timestamp,
    reasons: params.reasons,
    metrics: params.metrics,
  };
}

export function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
