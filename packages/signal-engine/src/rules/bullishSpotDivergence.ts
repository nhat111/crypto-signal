import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct } from './ruleHelpers.js';

/** Spec §7 Pattern D: price down while spot is actively buying. */
export function bullishSpotDivergence(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;
  if (!s.spot) return null; // futures-only symbol — no spot leg to compare against (ASSUMPTIONS.md §15)

  const priceDown = s.price.changePct <= -t.priceChangePct;
  const spotBuying = s.spot.cvdSkewRatio >= t.cvdSkewRatio;

  if (!(priceDown && spotBuying)) return null;

  const futuresAgrees = s.futures.cvdSkewRatio > 0;

  return buildSignal({
    snapshot: s,
    signalType: 'BULLISH_SPOT_DIVERGENCE',
    baseSeverity: 'MEDIUM',
    reasons: [
      `Price ${pct(s.price.changePct)}`,
      `Spot CVD skew ${s.spot.cvdSkewRatio.toFixed(3)} — spot is net buying despite the price drop`,
      futuresAgrees
        ? `Futures CVD skew ${s.futures.cvdSkewRatio.toFixed(3)} — futures agrees`
        : `Futures CVD skew ${s.futures.cvdSkewRatio.toFixed(3)} — futures does not yet agree`,
      'Interpretation: spot demand is diverging from price action. Worth watching, not a guaranteed reversal.',
    ],
    metrics: {
      priceChangePct: s.price.changePct,
      spotCvdSkewRatio: s.spot.cvdSkewRatio,
      futuresCvdSkewRatio: s.futures.cvdSkewRatio,
    },
    confirmed: futuresAgrees ? 1 : 0,
    totalChecks: 1,
    magnitudeValue: s.spot.cvdSkewRatio,
    magnitudeThreshold: t.cvdSkewRatio,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore('BULLISH_SPOT_DIVERGENCE'),
  });
}
