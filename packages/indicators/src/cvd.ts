import type { Candle } from '@crypto-signal/shared';

/**
 * delta = takerBuyVolume - takerSellVolume, straight from Binance's own
 * taker-buy-volume kline field — never from candle color (spec §5/§38).
 */
export function computeCandleDelta(candle: Candle): number {
  return candle.takerBuyBaseVolume - candle.takerSellBaseVolume;
}

/**
 * Normalizes delta into [-1, 1] so signal-engine thresholds are comparable
 * across symbols/timeframes regardless of absolute volume scale
 * (ASSUMPTIONS.md §2).
 */
export function computeSkewRatio(candle: Candle): number {
  if (candle.volume <= 0) return 0;
  return computeCandleDelta(candle) / candle.volume;
}

export function accumulateCvd(previousCumulative: number, candle: Candle): number {
  return previousCumulative + computeCandleDelta(candle);
}

export interface CvdPoint {
  timestamp: number;
  delta: number;
  skewRatio: number;
  cumulative: number;
}

/** Replays a full candle history into a CVD series, starting cumulative at 0. Used for backfill/chart seeding, not the live incremental path (see apps/worker for that). */
export function buildCvdSeries(candles: Candle[]): CvdPoint[] {
  let cumulative = 0;
  return candles.map((candle) => {
    const delta = computeCandleDelta(candle);
    cumulative += delta;
    return {
      timestamp: candle.openTime,
      delta,
      skewRatio: computeSkewRatio(candle),
      cumulative,
    };
  });
}
