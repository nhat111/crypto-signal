import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct } from './ruleHelpers.js';

/** Mirror of longCrowding: funding persistently negative while OI keeps rising — shorts piling in. */
export function shortCrowding(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;

  const fundingElevated = s.futures.fundingBias === 'elevated_negative' || s.futures.fundingBias === 'extreme_negative';
  const oiUp = s.futures.oiChangePct >= t.oiChangePct;

  if (!(fundingElevated && oiUp)) return null;

  const extreme = s.futures.fundingBias === 'extreme_negative';

  return buildSignal({
    snapshot: s,
    signalType: 'SHORT_CROWDING',
    baseSeverity: extreme ? 'HIGH' : 'MEDIUM',
    reasons: [
      `Funding is ${s.futures.fundingBias.replace('_', ' ')} at ${s.futures.fundingRatePct.toFixed(4)}% (elevated <= -${t.fundingElevatedPct}%, extreme <= -${t.fundingExtremePct}%)`,
      `Open interest ${pct(s.futures.oiChangePct)} — leveraged short exposure still growing`,
      'Interpretation: short positioning looks crowded. Risk framing: elevated short-squeeze risk if price reverses, not a prediction that it will.',
    ],
    metrics: {
      fundingRatePct: s.futures.fundingRatePct,
      oiChangePct: s.futures.oiChangePct,
    },
    confirmed: extreme ? 1 : 0,
    totalChecks: 1,
    magnitudeValue: s.futures.fundingRatePct,
    magnitudeThreshold: t.fundingElevatedPct,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore('SHORT_CROWDING'),
  });
}
