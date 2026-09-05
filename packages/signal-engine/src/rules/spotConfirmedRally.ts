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

  // The two optional checks, and they are the reason this rule's
  // confidence used to mean nothing.
  //
  // `confirmed` was hardcoded to 2 of 2 — a full mark awarded to every
  // instance, contributing a constant 30 of the 100 confidence points
  // however weak the rally was. Worse, it made the number
  // incomparable across signal types: the same market state scored 68 here
  // and 38 under a rule whose optional check actually failed, purely
  // because this one had no check to fail. The Signals page shows them
  // side by side.
  //
  // Both of these are real conditions the trigger does not require: a
  // rally can qualify with spot buying barely above zero and on ordinary
  // volume, and it is a meaningfully weaker rally when it does.
  const spotBuyingIsMeaningful = s.spot.cvdSkewRatio >= t.cvdSkewRatio;
  const volumeBacksIt = s.spot.volumeAnomaly !== 'normal';
  const confirmed = (spotBuyingIsMeaningful ? 1 : 0) + (volumeBacksIt ? 1 : 0);

  return buildSignal({
    snapshot: s,
    signalType: 'SPOT_CONFIRMED_RALLY',
    baseSeverity: 'INFO',
    reasons: [
      `Giá ${pct(s.price.changePct)} (ngưỡng để tính là ${num(t.priceChangePct)}%)`,
      skew(s.spot.cvdSkewRatio, 'Mua đứt (tiền thật)'),
      spotBuyingIsMeaningful
        ? `Lực mua đứt vượt ngưỡng đáng kể ${num(t.cvdSkewRatio, 2)} — không chỉ nhỉnh hơn 0`
        : `Lực mua đứt chỉ nhỉnh hơn 0, chưa tới ngưỡng đáng kể ${num(t.cvdSkewRatio, 2)} — cú tăng mỏng`,
      skew(s.futures.cvdSkewRatio, 'Tiền vay cũng cùng chiều'),
      volumeBacksIt
        ? 'Khối lượng mua đứt cao hơn thường lệ — có tiền thật đi kèm'
        : 'Khối lượng mua đứt ở mức bình thường — chưa có gì đặc biệt đỡ cú tăng này',
      `Tổng tiền đang đặt cược ${pct(s.futures.oiChangePct)} — tăng vừa phải, chưa quá nóng`,
      `Phí giữ lệnh ở mức bình thường (${num(s.futures.fundingRatePct, 4)}%)`,
    ],
    metrics: {
      priceChangePct: s.price.changePct,
      spotCvdSkewRatio: s.spot.cvdSkewRatio,
      futuresCvdSkewRatio: s.futures.cvdSkewRatio,
      oiChangePct: s.futures.oiChangePct,
      fundingRatePct: s.futures.fundingRatePct,
      spotVolumeAnomaly: s.spot.volumeAnomaly,
    },
    confirmed,
    totalChecks: 2,
    // Measured against the threshold that actually gated this rule.
    //
    // It used to be the spot CVD skew against `cvdSkewRatio` (0,15) — a
    // threshold this rule never applies, since it fires on skew merely
    // being above zero. Every instance below 0,15 therefore sat on the
    // magnitude floor of 20 regardless of how it differed, which is the
    // opposite of what magnitudeFromRatio documents itself as doing
    // ("~20 right at the threshold, 100 at 3x"). The price move is the
    // quantity this rule does gate on, so it is the one whose distance
    // past the line means something.
    magnitudeValue: s.price.changePct,
    magnitudeThreshold: t.priceChangePct,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore('SPOT_CONFIRMED_RALLY'),
  });
}
