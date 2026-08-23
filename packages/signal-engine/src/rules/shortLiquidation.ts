import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct } from './ruleHelpers.js';

/** Mirror of longLiquidation: price up, OI down, liquidation spike skewed to the short side (side === 'BUY' orders). */
export function shortLiquidation(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;

  const priceUp = s.price.changePct >= t.priceChangePct;
  const oiDown = s.futures.oiChangePct <= -t.oiChangePct;
  const shortSkewed = s.futures.liquidation.shortLiquidationUsd > s.futures.liquidation.longLiquidationUsd;
  const spike = s.futures.liquidationSpike && shortSkewed;

  if (!(priceUp && oiDown && spike)) return null;

  const extreme = s.futures.liquidationAnomalyRatio >= t.liquidationSpikeMult * 2;

  return buildSignal({
    snapshot: s,
    signalType: 'SHORT_LIQUIDATION',
    baseSeverity: 'HIGH',
    severitySteps: extreme ? 1 : 0,
    reasons: [
      `Price ${pct(s.price.changePct)}`,
      `Open interest ${pct(s.futures.oiChangePct)} — positions closing`,
      `Short liquidations $${s.futures.liquidation.shortLiquidationUsd.toFixed(0)} vs long liquidations $${s.futures.liquidation.longLiquidationUsd.toFixed(0)}`,
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
    historicalScore: ctx.getHistoricalScore('SHORT_LIQUIDATION'),
  });
}
