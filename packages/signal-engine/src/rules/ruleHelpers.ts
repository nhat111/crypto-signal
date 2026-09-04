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

/**
 * Percentages, Vietnamese decimal comma. These strings are read by people,
 * not parsed by anything — `metrics` carries the machine-readable copy.
 */
export function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')}%`;
}

export function num(n: number, digits = 2): string {
  return n.toFixed(digits).replace('.', ',');
}

/**
 * CVD skew as a sentence rather than a bare ratio.
 *
 * The stored figure is (mua chủ động − bán chủ động) / tổng khối lượng, so
 * it is already a share of volume and reads naturally as a percentage. A
 * reader who does not know what "skew 0,178" is can still act on "mua
 * nhiều hơn bán 17,8% khối lượng"; the raw ratio stays in brackets so the
 * number on screen still matches the number in `metrics`.
 */
export function skew(ratio: number, who: string): string {
  const share = num(Math.abs(ratio) * 100, 1);
  const side = ratio >= 0 ? 'mua nhiều hơn bán' : 'bán nhiều hơn mua';
  return `${who}: ${side} ${share}% khối lượng (chỉ số ${num(ratio, 3)})`;
}

/** Money, grouped the way it is read out loud rather than as fifteen digits. */
export function usd(n: number): string {
  if (n >= 1_000_000) return `${num(n / 1_000_000, 1)} triệu đô`;
  if (n >= 1_000) return `${num(n / 1_000, 0)} nghìn đô`;
  return `${num(n, 0)} đô`;
}
