import { computeEma, type OhlcvBar } from './technicals.js';

/**
 * Spot breakouts on the daily chart: the one rule that replayed positive
 * (ASSUMPTIONS §27), kept to exactly what was replayed so the live record
 * measures the same thing.
 *
 * - **Market**: BTC's daily close above its EMA200 and its EMA50 above the
 *   EMA200. Nothing is entered otherwise; the replay made its money in the
 *   rising half and lost in the falling one, and this gate is what kept
 *   most of the falling half out.
 * - **Entry**: a daily close above the highest high of the 20 days before,
 *   on a coin that closes above its own EMA200. Entered at that close.
 * - **Stop**: the lowest low of the last 10 days, entry day included. It
 *   never moves and is the order that sits on the exchange.
 * - **Exit**: a daily close under the trailing line, the lowest low of the
 *   10 days before that day, only ever raised. No fixed target: the winners
 *   that pay for the losers are the ones left to run.
 *
 * A candidate, not an instruction: nothing here knows the news or unlocks.
 */

export const BREAKOUT_LOOKBACK = 20;
export const TRAIL_LOOKBACK = 10;
export const BREAKOUT_EMA = 200;
const REGIME_FAST_EMA = 50;
/** Spot taker fee per side, as replayed. */
export const BREAKOUT_FEE_PCT = 0.1;

export interface BreakoutRegime {
  up: boolean;
  close: number;
  ema50: number;
  ema200: number;
  /** Open time of the BTC daily bar it was read on. */
  barOpenTime: number;
}

/** BTC's daily regime on its last closed bar; null with fewer than 200 bars. */
export function readBreakoutRegime(btcDaily: OhlcvBar[]): BreakoutRegime | null {
  const last = btcDaily[btcDaily.length - 1];
  const closes = btcDaily.map((b) => b.close);
  const ema200 = computeEma(closes, BREAKOUT_EMA);
  const ema50 = computeEma(closes, REGIME_FAST_EMA);
  if (!last || ema200 === null || ema50 === null) return null;
  return { up: last.close > ema200 && ema50 > ema200, close: last.close, ema50, ema200, barOpenTime: last.openTime };
}

export interface BreakoutCandidate {
  barOpenTime: number;
  entry: number;
  stop: number;
  /** The 20-day high the close broke. */
  high20: number;
  ema200: number;
  /** Entry to stop as a percent of entry. */
  stopPct: number;
}

/** A breakout on the last closed daily bar, or null. The market gate is the caller's: the record wants the candidate only when BTC is up. */
export function detectBreakout(daily: OhlcvBar[]): BreakoutCandidate | null {
  const n = daily.length;
  const last = daily[n - 1];
  if (!last || n < Math.max(BREAKOUT_EMA, BREAKOUT_LOOKBACK + 1)) return null;
  const ema200 = computeEma(
    daily.map((b) => b.close),
    BREAKOUT_EMA,
  );
  if (ema200 === null || last.close <= ema200) return null;
  const high20 = Math.max(...daily.slice(n - 1 - BREAKOUT_LOOKBACK, n - 1).map((b) => b.high));
  if (last.close <= high20) return null;
  const stop = Math.min(...daily.slice(n - TRAIL_LOOKBACK).map((b) => b.low));
  if (stop >= last.close) return null;
  return { barOpenTime: last.openTime, entry: last.close, stop, high20, ema200, stopPct: ((last.close - stop) / last.close) * 100 };
}

export type BreakoutExit = 'stop' | 'trail';

export type BreakoutStep =
  | { status: 'open'; trail: number }
  | { status: BreakoutExit; trail: number; exitPrice: number; exitTime: number };

/**
 * Walks the closed daily bars after the entry bar and says where the
 * position stands: still open (with today's trailing line) or out, how and
 * at what price. Stateless, recomputed from the bars each day, so a missed
 * day or a restart cannot leave the trail behind.
 *
 * The stop is checked first on every bar, at the worse of the open and the
 * stop (a gap down fills at the open); only then is the close compared
 * with the trail, which is raised with that bar's prior 10 lows first.
 */
export function stepBreakout(position: { barOpenTime: number; stop: number }, daily: OhlcvBar[]): BreakoutStep {
  const start = daily.findIndex((b) => b.openTime === position.barOpenTime);
  let trail = position.stop;
  if (start < 0) return { status: 'open', trail };
  for (let j = start + 1; j < daily.length; j += 1) {
    const bar = daily[j] as OhlcvBar;
    if (bar.low <= position.stop) return { status: 'stop', trail, exitPrice: Math.min(bar.open, position.stop), exitTime: bar.openTime };
    trail = Math.max(trail, Math.min(...daily.slice(Math.max(0, j - TRAIL_LOOKBACK), j).map((b) => b.low)));
    if (bar.close < trail) return { status: 'trail', trail, exitPrice: bar.close, exitTime: bar.openTime };
  }
  return { status: 'open', trail };
}

/** Result after fees: the return on the position and the same in multiples of the planned risk. */
export function breakoutResult(entry: number, stop: number, exit: number): { returnPct: number; r: number } {
  const fee = BREAKOUT_FEE_PCT / 100;
  const net = (exit * (1 - fee)) / (entry * (1 + fee)) - 1;
  return { returnPct: net * 100, r: (net * entry) / (entry - stop) };
}
