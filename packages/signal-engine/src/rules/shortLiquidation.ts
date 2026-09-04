import type { RuleContext, Signal } from '../types.js';
import { buildSignal, num, pct, usd } from './ruleHelpers.js';

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
      `Giá ${pct(s.price.changePct)}`,
      `Tổng tiền đang đặt cược ${pct(s.futures.oiChangePct)} — lệnh đang bị đóng`,
      `Bên cược giá xuống bị ép đóng ${usd(s.futures.liquidation.shortLiquidationUsd)}, bên cược giá lên ${usd(s.futures.liquidation.longLiquidationUsd)}`,
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
    historicalScore: ctx.getHistoricalScore('SHORT_LIQUIDATION'),
  });
}
