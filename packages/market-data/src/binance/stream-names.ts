import type { Timeframe } from '@crypto-signal/shared';
import { TIMEFRAMES } from '@crypto-signal/shared';

export function klineStreamName(symbol: string, timeframe: Timeframe): string {
  return `${symbol.toLowerCase()}@kline_${timeframe}`;
}

export function forceOrderStreamName(symbol: string): string {
  return `${symbol.toLowerCase()}@forceOrder`;
}

/** Inverse of klineStreamName — "btcusdt@kline_15m" -> "15m". */
export function timeframeFromKlineStream(streamName: string): Timeframe | undefined {
  const suffix = streamName.split('@kline_')[1];
  return TIMEFRAMES.find((tf) => tf === suffix);
}
