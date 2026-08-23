import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct } from './ruleHelpers.js';

/**
 * Spec §37 Scenario 3 + §8's price/OI table: price up + OI down. Explicitly
 * "Không được gọi đây là confirmed bullish" — confidence is capped and the
 * reasons say so in plain words.
 */
export function shortCoveringPossible(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;

  const priceUp = s.price.changePct >= t.priceChangePct;
  const oiDown = s.futures.oiChangePct <= -t.oiChangePct;
  const futuresBuying = s.futures.cvdSkewRatio >= t.cvdSkewRatio;

  if (!(priceUp && oiDown && futuresBuying)) return null;

  return buildSignal({
    snapshot: s,
    signalType: 'SHORT_COVERING_POSSIBLE',
    baseSeverity: 'LOW',
    reasons: [
      `Price ${pct(s.price.changePct)} while open interest ${pct(s.futures.oiChangePct)}`,
      `Futures CVD skew ${s.futures.cvdSkewRatio.toFixed(3)} — futures buying pressure`,
      'Interpretation: this pattern is consistent with short positions closing (buying to cover), not necessarily new bullish conviction. Not a confirmed bullish signal.',
    ],
    metrics: {
      priceChangePct: s.price.changePct,
      oiChangePct: s.futures.oiChangePct,
      futuresCvdSkewRatio: s.futures.cvdSkewRatio,
    },
    confirmed: 1,
    totalChecks: 1,
    magnitudeValue: s.futures.oiChangePct,
    magnitudeThreshold: t.oiChangePct,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore('SHORT_COVERING_POSSIBLE'),
    confidenceCap: 65,
  });
}
