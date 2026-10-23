import type { TradeSetup } from './types';

/**
 * Below this R:R from the live price, the plan the card prints is no longer
 * the plan on offer: the stop and target are fixed, so every bit the price
 * has run up since the 4H close comes out of the reward and goes into the
 * risk. 1.5 rather than the detector's 2 so a small drift does not flag.
 */
export const CHASED_RR = 1.5;
/** Same line as the journal's stop alert: under a quarter of the planned risk left. */
const NEAR_STOP_SHARE = 0.25;

export type SetupLiveState = 'ok' | 'chased' | 'near_stop' | 'past_stop' | 'past_target';

export interface SetupLiveRead {
  price: number;
  /** % from the entry to the live price. */
  movePct: number;
  /** % the price would still fall to reach the stop; negative once through it. */
  toStopPct: number;
  /** R:R if entered at the live price, with the same stop and target. Null once outside them. */
  rrNow: number | null;
  state: SetupLiveState;
}

/**
 * Where an open setup stands at the live price. Pure for testing.
 *
 * The card's entry is a closed 4H bar's close, often hours old. Whether
 * the setup is still the one described is a question about the price now,
 * and it is answered here rather than left to the reader's arithmetic.
 * Null without a usable price: no number beats a wrong one.
 */
export function setupLiveRead(s: Pick<TradeSetup, 'entry' | 'stop' | 'target'>, price: number | undefined): SetupLiveRead | null {
  if (price === undefined || !Number.isFinite(price) || !(price > 0) || !(s.entry > s.stop)) return null;
  const movePct = ((price - s.entry) / s.entry) * 100;
  const toStopPct = ((price - s.stop) / price) * 100;
  if (price <= s.stop) return { price, movePct, toStopPct, rrNow: null, state: 'past_stop' };
  if (price >= s.target) return { price, movePct, toStopPct, rrNow: null, state: 'past_target' };
  const rrNow = (s.target - price) / (price - s.stop);
  const state: SetupLiveState = price - s.stop < NEAR_STOP_SHARE * (s.entry - s.stop) ? 'near_stop' : rrNow < CHASED_RR ? 'chased' : 'ok';
  return { price, movePct, toStopPct, rrNow, state };
}

/** One line in Vietnamese, the same on the card and in the text copied for an AI. */
export function setupLiveText(r: SetupLiveRead): string {
  const fmt = (n: number): string => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(5).replace(/\.?0+$/, ''));
  const move = `${r.movePct > 0 ? '+' : ''}${r.movePct.toFixed(1)}%`;
  const head = `Giá giờ ${fmt(r.price)} (${move} so với giá vào)`;
  switch (r.state) {
    case 'past_stop':
      return `${head}: đã qua cắt lỗ, setup này hỏng.`;
    case 'past_target':
      return `${head}: đã qua chốt lời, lỡ rồi.`;
    case 'near_stop':
      return `${head}: sát cắt lỗ, chỉ còn ${r.toStopPct.toFixed(1)}%.`;
    case 'chased':
      return `${head}: đã chạy xa, vào giờ R:R chỉ còn 1:${(r.rrNow ?? 0).toFixed(1)}.`;
    default:
      return `${head} · còn ${r.toStopPct.toFixed(1)}% tới cắt lỗ · R:R nếu vào giờ 1:${(r.rrNow ?? 0).toFixed(1)}.`;
  }
}
