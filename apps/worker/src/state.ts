import type { Candle, SymbolId, Timeframe } from '@crypto-signal/shared';
import { CandleSequenceGuard } from '@crypto-signal/market-data';

export function stateKey(symbol: SymbolId, timeframe: Timeframe): string {
  return `${symbol}:${timeframe}`;
}

/**
 * Per (symbol, timeframe) mutable state the pipeline needs across candles:
 * sequence guards (dedupe/out-of-order, one per market since spot and
 * futures candles arrive on independent sockets), rolling history for
 * volume/ATR, and the last few connection-health facts. Deliberately plain
 * in-memory state — a single worker process owns the whole pipeline, so
 * there's no cross-process coordination to design for (rule: don't
 * over-engineer for a scale this project doesn't have yet).
 */
export class SymbolTimeframeState {
  readonly spotGuard: CandleSequenceGuard;
  readonly futuresGuard: CandleSequenceGuard;
  spotVolumeHistory: number[] = [];
  futuresVolumeHistory: number[] = [];
  recentTrueRanges: number[] = [];
  previousFuturesClose: number | undefined;
  spotCumulativeCvd = 0;
  futuresCumulativeCvd = 0;
  lastProcessedOpenTime: number | undefined;

  constructor(
    readonly symbol: SymbolId,
    readonly timeframe: Timeframe,
  ) {
    this.spotGuard = new CandleSequenceGuard(timeframe);
    this.futuresGuard = new CandleSequenceGuard(timeframe);
  }

  pushVolumeHistory(market: 'spot' | 'futures', volume: number, maxLen = 96): void {
    const arr = market === 'spot' ? this.spotVolumeHistory : this.futuresVolumeHistory;
    arr.push(volume);
    if (arr.length > maxLen) arr.shift();
  }

  pushTrueRange(tr: number, maxLen = 14): void {
    this.recentTrueRanges.push(tr);
    if (this.recentTrueRanges.length > maxLen) this.recentTrueRanges.shift();
  }
}

/**
 * Spot and futures kline WS streams are independent sockets — a closed
 * candle for the same (symbol, timeframe, openTime) can arrive from either
 * side first, or the other side can be missing entirely if a socket is
 * degraded. This buffer pairs them up and lets the caller apply a REST
 * fallback once a wait deadline passes (spec §29 "REST fallback").
 */
export class CandlePairBuffer {
  private readonly pending = new Map<string, { spot?: Candle; futures?: Candle; firstSeenAt: number }>();

  constructor(private readonly maxWaitMs = 8_000) {}

  private key(symbol: SymbolId, timeframe: Timeframe, openTime: number): string {
    return `${symbol}:${timeframe}:${openTime}`;
  }

  add(candle: Candle): { spot: Candle; futures: Candle } | null {
    const key = this.key(candle.symbol, candle.timeframe, candle.openTime);
    const entry = this.pending.get(key) ?? { firstSeenAt: Date.now() };
    entry[candle.market] = candle;
    this.pending.set(key, entry);

    if (entry.spot && entry.futures) {
      this.pending.delete(key);
      return { spot: entry.spot, futures: entry.futures };
    }
    return null;
  }

  /** Entries that have waited past maxWaitMs for their missing side — caller should REST-fetch the gap and retry `add`. */
  timedOutEntries(now = Date.now()): Array<{ symbol: SymbolId; timeframe: Timeframe; openTime: number; missing: 'spot' | 'futures' }> {
    const results: Array<{ symbol: SymbolId; timeframe: Timeframe; openTime: number; missing: 'spot' | 'futures' }> = [];
    for (const [key, entry] of this.pending) {
      if (now - entry.firstSeenAt < this.maxWaitMs) continue;
      const [symbol, timeframe, openTimeStr] = key.split(':');
      const missing = entry.spot ? 'futures' : 'spot';
      results.push({ symbol: symbol as SymbolId, timeframe: timeframe as Timeframe, openTime: Number(openTimeStr), missing });
    }
    return results;
  }

  drop(symbol: SymbolId, timeframe: Timeframe, openTime: number): void {
    this.pending.delete(this.key(symbol, timeframe, openTime));
  }
}
