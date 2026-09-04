import type { RuleContext, Signal } from '../types.js';
import { buildSignal, num, pct, usd } from './ruleHelpers.js';

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
      `Giá ${pct(s.price.changePct)}`,
      `Tổng tiền đang đặt cược ${pct(s.futures.oiChangePct)} — lệnh đang bị đóng`,
      `Bên cược giá lên bị ép đóng ${usd(s.futures.liquidation.longLiquidationUsd)}, bên cược giá xuống ${usd(s.futures.liquidation.shortLiquidationUsd)}`,
      `Gấp ${num(s.futures.liquidationAnomalyRatio)} lần mức trung bình 24h (tính là bất thường từ ${num(t.liquidationSpikeMult)} lần)`,
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
