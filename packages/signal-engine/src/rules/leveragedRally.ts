import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct } from './ruleHelpers.js';

/**
 * Spec §7 Pattern A. Price up, spot selling, futures buying, OI expanding —
 * "giá tăng nhưng lực mua spot không xác nhận; futures đang đóng vai trò
 * lớn". Never phrased as a crash call — only as a leverage-dependency flag.
 */
export function leveragedRally(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;
  if (!s.spot) return null; // futures-only symbol — no spot leg to compare against (ASSUMPTIONS.md §15)

  const priceUp = s.price.changePct >= t.priceChangePct;
  const spotSelling = s.spot.cvdSkewRatio <= -t.cvdSkewRatio;
  const futuresBuying = s.futures.cvdSkewRatio >= t.cvdSkewRatio;
  const oiUp = s.futures.oiChangePct >= t.oiChangePct;

  if (!(priceUp && spotSelling && futuresBuying && oiUp)) return null;

  const fundingElevated = s.futures.fundingBias === 'elevated_positive' || s.futures.fundingBias === 'extreme_positive';
  const fundingExtreme = s.futures.fundingBias === 'extreme_positive';
  const volumeConfirms = s.futures.volumeAnomaly === 'abnormal' || s.futures.volumeAnomaly === 'extreme';

  const confirmed = [fundingElevated, volumeConfirms].filter(Boolean).length;

  return buildSignal({
    snapshot: s,
    signalType: 'LEVERAGED_RALLY',
    baseSeverity: 'MEDIUM',
    severitySteps: (fundingElevated ? 1 : 0) + (fundingExtreme ? 1 : 0),
    reasons: [
      `Price ${pct(s.price.changePct)} (>= ${t.priceChangePct}% threshold)`,
      `Spot CVD skew ${s.spot.cvdSkewRatio.toFixed(3)} — spot is net selling`,
      `Futures CVD skew ${s.futures.cvdSkewRatio.toFixed(3)} — futures is net buying`,
      `Open interest ${pct(s.futures.oiChangePct)} — new leveraged positioning entering`,
      fundingElevated
        ? `Funding is ${s.futures.fundingBias.replace('_', ' ')} (${s.futures.fundingRatePct.toFixed(4)}%)`
        : `Funding neutral (${s.futures.fundingRatePct.toFixed(4)}%)`,
      'Interpretation: price is rising but spot buying does not confirm it — futures/leverage is doing the driving. This is not a call that the market will fall.',
    ],
    metrics: {
      priceChangePct: s.price.changePct,
      spotCvdSkewRatio: s.spot.cvdSkewRatio,
      futuresCvdSkewRatio: s.futures.cvdSkewRatio,
      oiChangePct: s.futures.oiChangePct,
      fundingRatePct: s.futures.fundingRatePct,
      volumeAnomaly: s.futures.volumeAnomaly,
    },
    confirmed,
    totalChecks: 2,
    magnitudeValue: s.spot.cvdSkewRatio,
    magnitudeThreshold: t.cvdSkewRatio,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore('LEVERAGED_RALLY'),
  });
}
