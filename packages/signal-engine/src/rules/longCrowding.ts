import type { RuleContext, Signal } from '../types.js';
import { buildSignal, num, pct } from './ruleHelpers.js';

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
      `Phí giữ lệnh ${num(s.futures.fundingRatePct, 4)}% — bên đặt cược giá lên đang phải trả phí cho bên kia (cao bất thường từ ${num(t.fundingElevatedPct, 4)}%, cực đoan từ ${num(t.fundingExtremePct, 4)}%)`,
      `Tổng tiền đang đặt cược ${pct(s.futures.oiChangePct)} — vẫn đang có thêm người vào cược giá lên`,
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
