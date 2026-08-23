import type { Timeframe } from './types.js';

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
};

export function timeframeToMs(tf: Timeframe): number {
  return TIMEFRAME_MS[tf];
}

/** Binance kline `interval` string uses the same tokens we use for Timeframe. */
export function timeframeToBinanceInterval(tf: Timeframe): string {
  return tf;
}

/** openInterestHist `period` uses the same tokens too (verified in ASSUMPTIONS.md §1). */
export function timeframeToOpenInterestPeriod(tf: Timeframe): string {
  return tf;
}

export function nowUtcMs(): number {
  return Date.now();
}

/** Floors a UTC timestamp to the start of its timeframe bucket. All Binance kline open times already align to this, so this is mainly used to validate/backfill. */
export function bucketStart(timestampMs: number, tf: Timeframe): number {
  const size = timeframeToMs(tf);
  return Math.floor(timestampMs / size) * size;
}

export function isoUtc(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}
