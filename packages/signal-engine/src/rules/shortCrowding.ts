import type { RuleContext, Signal } from '../types.js';
import { buildSignal, num, pct } from './ruleHelpers.js';

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
      `Phí giữ lệnh ${num(s.futures.fundingRatePct, 4)}% — bên đặt cược giá xuống đang phải trả phí cho bên kia (cao bất thường từ -${num(t.fundingElevatedPct, 4)}%, cực đoan từ -${num(t.fundingExtremePct, 4)}%)`,
      `Tổng tiền đang đặt cược ${pct(s.futures.oiChangePct)} — vẫn đang có thêm người vào cược giá xuống`,
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
