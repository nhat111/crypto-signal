import type { Candle } from '@crypto-signal/shared';
import { clamp } from '@crypto-signal/shared';

export function computeReturnPct(open: number, close: number): number {
  return open > 0 ? ((close - open) / open) * 100 : 0;
}

export function computeTrueRange(candle: Pick<Candle, 'high' | 'low'>, previousClose: number | undefined): number {
  if (previousClose === undefined) return candle.high - candle.low;
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );
}

/** Simple moving average of true ranges (documented as a deliberate MVP simplification vs. Wilder smoothing — both are "ATR", the spec doesn't require a specific smoothing method). */
export function computeAtr(trueRanges: number[]): number {
  if (trueRanges.length === 0) return 0;
  return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}

export function computeAtrPct(atr: number, close: number): number {
  return close > 0 ? (atr / close) * 100 : 0;
}

/**
 * How many prior candles a volatility baseline needs before it is allowed
 * to call anything abnormal.
 *
 * Ten of the fourteen-candle window. Fewer than that and one violent
 * candle *is* the average, so the very move being judged sets the bar it
 * is judged against, and everything looks normal exactly when it isn't.
 */
export const MIN_BASELINE_RANGES = 10;

/**
 * Volatility as it stood *before* the candle being judged.
 *
 * `atrPct` above includes the current true range, which is the right
 * choice for describing a market and the wrong one for detecting a shock:
 * a candle that moves five times the usual amount inflates its own
 * denominator and shrinks its own ratio. This one deliberately excludes
 * it.
 *
 * Null rather than 0 when the history is too short — a missing baseline
 * must not read as "volatility is zero", which would make every move
 * infinitely abnormal.
 */
export function computeBaselineAtrPct(recentTrueRanges: number[], referencePrice: number): number | null {
  if (recentTrueRanges.length < MIN_BASELINE_RANGES) return null;
  if (referencePrice <= 0) return null;
  const pct = computeAtrPct(computeAtr(recentTrueRanges), referencePrice);
  return pct > 0 ? pct : null;
}

/**
 * 0-100 "price structure" quality used by the health engine: penalizes
 * outsized volatility regardless of direction, since a market whipping
 * around is structurally less trustworthy than one moving cleanly — this
 * scoring curve is our own heuristic (ASSUMPTIONS.md §7), not a spec formula.
 */
export function computePriceStructureScore(atrPct: number): number {
  const volatilityPenalty = clamp(atrPct * 8, 0, 70);
  return clamp(100 - volatilityPenalty, 0, 100);
}
