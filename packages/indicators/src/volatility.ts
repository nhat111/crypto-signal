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
 * 0-100 "price structure" quality used by the health engine: penalizes
 * outsized volatility regardless of direction, since a market whipping
 * around is structurally less trustworthy than one moving cleanly — this
 * scoring curve is our own heuristic (ASSUMPTIONS.md §7), not a spec formula.
 */
export function computePriceStructureScore(atrPct: number): number {
  const volatilityPenalty = clamp(atrPct * 8, 0, 70);
  return clamp(100 - volatilityPenalty, 0, 100);
}
