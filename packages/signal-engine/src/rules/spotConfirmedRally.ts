import type { RuleContext, Signal } from '../types.js';
import { buildSignal, num, pct, skew } from './ruleHelpers.js';

/** Spec §7 Pattern B / §3 Phase 3 item 1's opposite case — "market khỏe hơn". */
export function spotConfirmedRally(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;
  if (!s.spot) return null; // futures-only symbol — no spot leg to compare against (ASSUMPTIONS.md §15)

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
      `Giá ${pct(s.price.changePct)} (ngưỡng để tính là ${num(t.priceChangePct)}%)`,
      skew(s.spot.cvdSkewRatio, 'Mua đứt (tiền thật)'),
      skew(s.futures.cvdSkewRatio, 'Tiền vay cũng cùng chiều'),
      `Tổng tiền đang đặt cược ${pct(s.futures.oiChangePct)} — tăng vừa phải, chưa quá nóng`,
      `Phí giữ lệnh ở mức bình thường (${num(s.futures.fundingRatePct, 4)}%)`,
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
