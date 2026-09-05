import type { RuleContext, Signal } from '../types.js';
import { buildSignal, num, pct } from './ruleHelpers.js';

/**
 * The candle moved far more than this market's own recent volatility.
 *
 * Every other rule in here describes *structure* — who is buying, with
 * whose money, against what positioning. None of them answers the
 * question someone actually asks first: did the price just do something
 * violent? A 5% BTC candle can pass every structural filter and still be
 * the only thing worth being woken up for.
 *
 * "Abnormal" is measured against the symbol's own recent range rather
 * than a fixed percentage, because a fixed percentage is wrong for
 * everything: 3% is a crash for BTC on a quiet week and a rounding error
 * for a small cap in a bull run. The baseline deliberately excludes the
 * candle being judged (see computeBaselineAtrPct) — otherwise a violent
 * candle inflates the very average it is compared against, and the
 * biggest moves are the ones this would miss.
 *
 * Up and down are separate signal types on purpose. They are different
 * events with different follow-through, and blending them into one
 * "shock" type would produce a performance record that averages the two
 * into a meaningless coin flip.
 */
export function priceShock(ctx: RuleContext): Signal | null {
  const { snapshot: s, thresholds: t } = ctx;

  // No baseline means no claim. On a cold start every symbol would
  // otherwise look infinitely abnormal, and an alert storm on boot is how
  // someone learns to mute the channel.
  const baseline = s.price.baselineAtrPct;
  if (baseline === null) return null;

  const movePct = s.price.changePct;
  const magnitude = Math.abs(movePct);
  if (magnitude < t.priceShockMinMovePct) return null;

  const ratio = magnitude / baseline;
  if (ratio < t.priceShockAtrMult) return null;

  const up = movePct > 0;
  const signalType = up ? 'PRICE_SPIKE_UP' : 'PRICE_SPIKE_DOWN';

  // Volume and forced closes do not make the move happen; they say whether
  // anything real was behind it. A large candle on thin volume is a
  // different animal from one that traded three times the usual amount.
  const heavyVolume = s.futures.volumeRatio >= t.volumeElevatedMult;
  const forcedClosing = s.futures.liquidationSpike;

  const severitySteps = ratio >= t.priceShockAtrMult * 2 ? 2 : ratio >= t.priceShockAtrMult * 1.5 ? 1 : 0;

  const reasons = [
    `Giá ${pct(movePct)} trong một cây nến ${s.timeframe}`,
    `Gấp ${num(ratio, 1)} lần biên độ thường ngày của chính nó (trung bình ${num(baseline, 2)}% mỗi nến, tính là bất thường từ ${num(t.priceShockAtrMult, 1)} lần)`,
    heavyVolume
      ? `Khối lượng gấp ${num(s.futures.volumeRatio, 1)} lần trung bình — có tiền thật đi kèm`
      : `Khối lượng chỉ ${num(s.futures.volumeRatio, 1)} lần trung bình — cú này mỏng, dễ là quét thanh khoản`,
  ];
  if (forcedClosing) reasons.push('Kèm theo một đợt cháy lệnh bất thường — nhiều vị thế bị ép đóng.');

  return buildSignal({
    snapshot: s,
    signalType,
    baseSeverity: 'MEDIUM',
    severitySteps,
    reasons,
    metrics: {
      priceChangePct: movePct,
      baselineAtrPct: baseline,
      shockRatio: ratio,
      volumeRatio: s.futures.volumeRatio,
      liquidationSpike: forcedClosing,
    },
    confirmed: (heavyVolume ? 1 : 0) + (forcedClosing ? 1 : 0),
    totalChecks: 2,
    magnitudeValue: ratio,
    magnitudeThreshold: t.priceShockAtrMult,
    confidenceWeights: ctx.confidenceWeights,
    historicalScore: ctx.getHistoricalScore(signalType),
  });
}
