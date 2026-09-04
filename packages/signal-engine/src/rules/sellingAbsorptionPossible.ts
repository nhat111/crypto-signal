import type { RuleContext, Signal } from '../types.js';
import { buildSignal, pct, skew } from './ruleHelpers.js';

/**
 * Spec §7 Pattern C / §37 Scenario 5: spot selling but price holds. "Không
 * được kết luận chắc chắn là bullish. Cần chờ confirmation." — confidence
 * capped low unless there's real confirmation.
 */
export function sellingAbsorptionPossible(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;
  if (!s.spot) return null; // futures-only symbol — no spot leg to compare against (ASSUMPTIONS.md §15)

  const spotSelling = s.spot.cvdSkewRatio <= -t.cvdSkewRatio;
  const priceHolding = Math.abs(s.price.changePct) < t.priceChangePct;

  if (!(spotSelling && priceHolding)) return null;

  const volumeConfirms = s.spot.volumeAnomaly === 'abnormal' || s.spot.volumeAnomaly === 'extreme';

  return buildSignal({
    snapshot: s,
    signalType: 'SELLING_ABSORPTION_POSSIBLE',
    baseSeverity: 'LOW',
    reasons: [
      skew(s.spot.cvdSkewRatio, 'Mua đứt (tiền thật) đang bán ra'),
      `Nhưng giá chỉ ${pct(s.price.changePct)} — không rơi tương ứng với lượng bán đó`,
      volumeConfirms
        ? 'Khối lượng giao dịch cao hơn thường lệ — lượng bán thật đang được ai đó mua hết'
        : 'Khối lượng chưa xác nhận — coi là khả năng độ tin cậy thấp, chưa phải kết luận',
    ],
    metrics: {
      spotCvdSkewRatio: s.spot.cvdSkewRatio,
      priceChangePct: s.price.changePct,
      spotVolumeAnomaly: s.spot.volumeAnomaly,
    },
    confirmed: volumeConfirms ? 1 : 0,
    totalChecks: 1,
    magnitudeValue: s.spot.cvdSkewRatio,
    magnitudeThreshold: t.cvdSkewRatio,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore('SELLING_ABSORPTION_POSSIBLE'),
    confidenceCap: volumeConfirms ? 60 : 45,
  });
}
