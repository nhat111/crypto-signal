import type { OpenInterestPoint, Timeframe } from '@crypto-signal/shared';
import { timeframeToMs } from '@crypto-signal/shared';

export interface OiChange {
  changePct: number;
  changeAbs: number;
  /** changePct normalized to "% per hour", so a 5m bucket and a 4h bucket with the same %/bucket read as very different urgency (spec §8 "OI velocity"). */
  velocityPctPerHour: number;
}

export function computeOiChange(
  current: OpenInterestPoint,
  previous: OpenInterestPoint | undefined,
  timeframe: Timeframe,
): OiChange {
  if (!previous || previous.sumOpenInterest <= 0) {
    return { changePct: 0, changeAbs: 0, velocityPctPerHour: 0 };
  }
  const changeAbs = current.sumOpenInterest - previous.sumOpenInterest;
  const changePct = (changeAbs / previous.sumOpenInterest) * 100;
  const hours = timeframeToMs(timeframe) / 3_600_000;
  return { changePct, changeAbs, velocityPctPerHour: changePct / hours };
}

/**
 * Spec §8's price/OI interpretation table — returned as a label only, never
 * used on its own as a signal (the spec explicitly forbids treating this
 * table as an absolute conclusion).
 */
export type OiPriceInterpretation =
  | 'new_positions_entering_up'
  | 'short_covering_possible'
  | 'new_positions_entering_down'
  | 'long_liquidation_or_closing_possible'
  | 'inconclusive';

export function interpretOiVsPrice(priceChangePct: number, oiChangePct: number, priceThreshold: number, oiThreshold: number): OiPriceInterpretation {
  const priceUp = priceChangePct >= priceThreshold;
  const priceDown = priceChangePct <= -priceThreshold;
  const oiUp = oiChangePct >= oiThreshold;
  const oiDown = oiChangePct <= -oiThreshold;

  if (priceUp && oiUp) return 'new_positions_entering_up';
  if (priceUp && oiDown) return 'short_covering_possible';
  if (priceDown && oiUp) return 'new_positions_entering_down';
  if (priceDown && oiDown) return 'long_liquidation_or_closing_possible';
  return 'inconclusive';
}
