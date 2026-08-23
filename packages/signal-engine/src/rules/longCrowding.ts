import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct } from './ruleHelpers.js';

/** Funding persistently positive while OI keeps rising — many longs piled in, raising squeeze risk if price reverses. */
export function longCrowding(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;

  const fundingElevated = s.futures.fundingBias === 'elevated_positive' || s.futures.fundingBias === 'extreme_positive';
  const oiUp = s.futures.oiChangePct >= t.oiChangePct;

  if (!(fundingElevated && oiUp)) return null;

  const extreme = s.futures.fundingBias === 'extreme_positive';

  return buildSignal({
    snapshot: s,
    signalType: 'LONG_CROWDING',
    baseSeverity: extreme ? 'HIGH' : 'MEDIUM',
    reasons: [
      `Funding is ${s.futures.fundingBias.replace('_', ' ')} at ${s.futures.fundingRatePct.toFixed(4)}% (elevated >= ${t.fundingElevatedPct}%, extreme >= ${t.fundingExtremePct}%)`,
      `Open interest ${pct(s.futures.oiChangePct)} — leveraged long exposure still growing`,
      'Interpretation: long positioning looks crowded. Risk framing: elevated long-squeeze risk if price reverses, not a prediction that it will.',
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
    historicalScore: ctx.getHistoricalScore('LONG_CROWDING'),
  });
}
