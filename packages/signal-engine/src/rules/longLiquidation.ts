import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct } from './ruleHelpers.js';

/** Spec §37 Scenario 4: price down, OI down, and a liquidation spike skewed to the long side (side === 'SELL' orders, see indicators/liquidationAnomaly.ts). */
export function longLiquidation(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;

  const priceDown = s.price.changePct <= -t.priceChangePct;
  const oiDown = s.futures.oiChangePct <= -t.oiChangePct;
  const longSkewed = s.futures.liquidation.longLiquidationUsd > s.futures.liquidation.shortLiquidationUsd;
  const spike = s.futures.liquidationSpike && longSkewed;

  if (!(priceDown && oiDown && spike)) return null;

  const extreme = s.futures.liquidationAnomalyRatio >= t.liquidationSpikeMult * 2;

  return buildSignal({
    snapshot: s,
    signalType: 'LONG_LIQUIDATION',
    baseSeverity: 'HIGH',
    severitySteps: extreme ? 1 : 0,
    reasons: [
      `Price ${pct(s.price.changePct)}`,
      `Open interest ${pct(s.futures.oiChangePct)} — positions closing`,
      `Long liquidations $${s.futures.liquidation.longLiquidationUsd.toFixed(0)} vs short liquidations $${s.futures.liquidation.shortLiquidationUsd.toFixed(0)}`,
      `Liquidation anomaly ratio ${s.futures.liquidationAnomalyRatio.toFixed(2)}x rolling 24h average (threshold ${t.liquidationSpikeMult}x)`,
    ],
    metrics: {
      priceChangePct: s.price.changePct,
      oiChangePct: s.futures.oiChangePct,
      longLiquidationUsd: s.futures.liquidation.longLiquidationUsd,
      shortLiquidationUsd: s.futures.liquidation.shortLiquidationUsd,
      liquidationAnomalyRatio: s.futures.liquidationAnomalyRatio,
    },
    confirmed: extreme ? 1 : 0,
    totalChecks: 1,
    magnitudeValue: s.futures.liquidationAnomalyRatio,
    magnitudeThreshold: t.liquidationSpikeMult,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore('LONG_LIQUIDATION'),
  });
}
