import type { Candle, LiquidationEvent, Market, SymbolId, Timeframe } from '@crypto-signal/shared';
import { timeframeToMs } from '@crypto-signal/shared';

/** Index layout shared by /api/v3/klines and /fapi/v1/klines (ASSUMPTIONS.md §1). */
export type RawKline = [
  number, // open time
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // close time
  string, // quote asset volume
  number, // number of trades
  string, // taker buy base asset volume
  string, // taker buy quote asset volume
  string, // ignore
];

export function rawKlineToCandle(
  raw: RawKline,
  symbol: SymbolId,
  market: Market,
  timeframe: Timeframe,
): Candle {
  const volume = Number(raw[5]);
  const takerBuyBaseVolume = Number(raw[9]);
  return {
    symbol,
    market,
    timeframe,
    openTime: raw[0],
    closeTime: raw[6],
    open: Number(raw[1]),
    high: Number(raw[2]),
    low: Number(raw[3]),
    close: Number(raw[4]),
    volume,
    quoteVolume: Number(raw[7]),
    trades: raw[8],
    takerBuyBaseVolume,
    takerBuyQuoteVolume: Number(raw[10]),
    takerSellBaseVolume: volume - takerBuyBaseVolume,
    ingestedAt: Date.now(),
  };
}

/** Shape of the `k` object inside a Binance kline WS payload. */
export interface WsKlinePayload {
  t: number; // kline start time
  T: number; // kline close time
  o: string;
  h: string;
  l: string;
  c: string;
  v: string; // base asset volume
  n: number; // number of trades
  x: boolean; // is this kline closed?
  q: string; // quote asset volume
  V: string; // taker buy base asset volume
  Q: string; // taker buy quote asset volume
}

/** Returns null when the candle isn't closed yet — the pipeline only ever acts on closed candles, matching how shuffling/scoring elsewhere in this codebase treats "final" data as the only trustworthy moment. */
export function wsKlineToCandle(
  k: WsKlinePayload,
  symbol: SymbolId,
  market: Market,
  timeframe: Timeframe,
): Candle | null {
  if (!k.x) return null;
  const volume = Number(k.v);
  const takerBuyBaseVolume = Number(k.V);
  return {
    symbol,
    market,
    timeframe,
    openTime: k.t,
    closeTime: k.T,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume,
    quoteVolume: Number(k.q),
    trades: k.n,
    takerBuyBaseVolume,
    takerBuyQuoteVolume: Number(k.Q),
    takerSellBaseVolume: volume - takerBuyBaseVolume,
    ingestedAt: Date.now(),
  };
}

export interface ForceOrderPayload {
  o: {
    s: string;
    S: 'BUY' | 'SELL';
    o: string;
    q: string;
    p: string;
    ap: string;
    X: string;
    T: number;
  };
}

export function forceOrderToLiquidation(payload: ForceOrderPayload): LiquidationEvent {
  const o = payload.o;
  const averagePrice = Number(o.ap);
  const quantity = Number(o.q);
  return {
    symbol: o.s,
    side: o.S,
    orderType: o.o,
    quantity,
    price: Number(o.p),
    averagePrice,
    orderStatus: o.X,
    orderTradeTime: o.T,
    quoteQuantity: quantity * (averagePrice || Number(o.p)),
  };
}

export type CandleAcceptResult =
  | { accepted: true; gapCandles: number }
  | { accepted: false; reason: 'duplicate' | 'out_of_order' };

/**
 * Per (symbol, market, timeframe) sequence guard. Binance combined streams
 * can, in principle, redeliver a message on reconnect or race two sockets
 * during a resubscribe — this is the single place that decides what counts
 * as a duplicate, an out-of-order delivery, or a gap (spec §29: "Missing-data
 * detection, Duplicate detection, Out-of-order event handling").
 *
 * Deterministic and side-effect-free apart from its own last-seen state, so
 * it's directly unit-testable without a real socket.
 */
export class CandleSequenceGuard {
  private lastOpenTime: number | undefined;

  constructor(private readonly timeframe: Timeframe) {}

  accept(candle: Candle): CandleAcceptResult {
    const stepMs = timeframeToMs(this.timeframe);

    if (this.lastOpenTime === undefined) {
      this.lastOpenTime = candle.openTime;
      return { accepted: true, gapCandles: 0 };
    }

    if (candle.openTime <= this.lastOpenTime) {
      return {
        accepted: false,
        reason: candle.openTime === this.lastOpenTime ? 'duplicate' : 'out_of_order',
      };
    }

    const stepsAhead = Math.round((candle.openTime - this.lastOpenTime) / stepMs);
    const gapCandles = Math.max(0, stepsAhead - 1);
    this.lastOpenTime = candle.openTime;
    return { accepted: true, gapCandles };
  }

  reset(): void {
    this.lastOpenTime = undefined;
  }
}
