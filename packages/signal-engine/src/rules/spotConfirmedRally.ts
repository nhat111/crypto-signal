import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct } from './ruleHelpers.js';

/** Spec §7 Pattern B / §3 Phase 3 item 1's opposite case — "market khỏe hơn". */
export function spotConfirmedRally(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;

  const priceUp = s.price.changePct >= t.priceChangePct;
  const spotConfirms = s.spot.cvdSkewRatio > 0;
  const futuresConfirms = s.futures.cvdSkewRatio > 0;
  const oiModerate = s.futures.oiChangePct > 0 && s.futures.oiChangePct < t.oiStrongChangePct;
  const fundingNeutral = s.futures.fundingBias === 'neutral';

  if (!(priceUp && spotConfirms && futuresConfirms && oiModerate && fundingNeutral)) return null;

  return buildSignal({
    snapshot: s,
    signalType: 'SPOT_CONFIRMED_RALLY',
    baseSeverity: 'INFO',
    reasons: [
      `Price ${pct(s.price.changePct)} (>= ${t.priceChangePct}% threshold)`,
      `Spot CVD skew ${s.spot.cvdSkewRatio.toFixed(3)} — spot is net buying`,
      `Futures CVD skew ${s.futures.cvdSkewRatio.toFixed(3)} — futures agrees`,
      `Open interest ${pct(s.futures.oiChangePct)} — moderate, not overheated`,
      `Funding neutral (${s.futures.fundingRatePct.toFixed(4)}%)`,
      'Interpretation: real spot demand is confirming this move, not leverage alone.',
    ],
    metrics: {
      priceChangePct: s.price.changePct,
      spotCvdSkewRatio: s.spot.cvdSkewRatio,
      futuresCvdSkewRatio: s.futures.cvdSkewRatio,
      oiChangePct: s.futures.oiChangePct,
      fundingRatePct: s.futures.fundingRatePct,
    },
    confirmed: 2,
    totalChecks: 2,
    magnitudeValue: s.spot.cvdSkewRatio,
    magnitudeThreshold: t.cvdSkewRatio,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore('SPOT_CONFIRMED_RALLY'),
  });
}
