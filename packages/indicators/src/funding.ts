import type { Thresholds } from '@crypto-signal/shared';

export type FundingBias = 'extreme_positive' | 'elevated_positive' | 'neutral' | 'elevated_negative' | 'extreme_negative';

/**
 * `fundingRateFraction` is Binance's raw value (e.g. 0.0001). Thresholds in
 * config are expressed in percent (0.01 means 0.01%) to match the spec's
 * own wording (§9), so we convert once here rather than scattering *100
 * conversions through the codebase.
 */
export function classifyFunding(fundingRateFraction: number, thresholds: Thresholds): FundingBias {
  const pct = fundingRateFraction * 100;
  if (pct >= thresholds.fundingExtremePct) return 'extreme_positive';
  if (pct >= thresholds.fundingElevatedPct) return 'elevated_positive';
  if (pct <= -thresholds.fundingExtremePct) return 'extreme_negative';
  if (pct <= -thresholds.fundingElevatedPct) return 'elevated_negative';
  return 'neutral';
}

export function isFundingElevated(bias: FundingBias): boolean {
  return bias !== 'neutral';
}

export function fundingRateToPct(fundingRateFraction: number): number {
  return fundingRateFraction * 100;
}
