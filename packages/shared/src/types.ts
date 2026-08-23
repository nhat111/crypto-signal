/**
 * Domain types shared across every package/app. Keep this file free of
 * behavior — pure types/interfaces only, so every layer (collector,
 * indicator, signal, health, db, api, web, telegram) can depend on it
 * without pulling in unrelated code.
 */

export type Market = 'spot' | 'futures';

export type Timeframe = '5m' | '15m' | '1h' | '4h';

export const TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '1h', '4h'];

/** Binance symbol, e.g. "BTCUSDT". Validated against config.symbols at runtime, not a literal union, so adding a symbol is a config change, not a code change. */
export type SymbolId = string;

/**
 * One closed candle, already normalized from either the Spot or Futures
 * kline REST/WS payload into a single shape. All timestamps are UTC epoch
 * milliseconds.
 */
export interface Candle {
  symbol: SymbolId;
  market: Market;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base-asset volume for the whole candle. */
  volume: number;
  quoteVolume: number;
  trades: number;
  /** Straight from Binance's kline field 9 — not derived from candle color. */
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
  /** volume - takerBuyBaseVolume, computed once here so nobody re-derives it inconsistently. */
  takerSellBaseVolume: number;
  /** When this candle was received/normalized locally — used for data-quality/staleness checks, distinct from openTime/closeTime which are exchange (source) timestamps. */
  ingestedAt: number;
}

export interface OpenInterestPoint {
  symbol: SymbolId;
  timeframe: Timeframe;
  timestamp: number;
  sumOpenInterest: number;
  sumOpenInterestValue: number;
}

export interface FundingRatePoint {
  symbol: SymbolId;
  fundingTime: number;
  fundingRate: number;
  markPrice: number | null;
}

export interface MarkPriceSnapshot {
  symbol: SymbolId;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  time: number;
}

/**
 * One force-liquidation order pushed by Binance's forceOrder stream.
 * `side` is the side of the liquidating order itself: a SELL order force-closes
 * a LONG position (long liquidation); a BUY order force-closes a SHORT
 * position (short liquidation). See packages/indicators/src/liquidationAnomaly.ts.
 */
export interface LiquidationEvent {
  symbol: SymbolId;
  side: 'BUY' | 'SELL';
  orderType: string;
  quantity: number;
  price: number;
  averagePrice: number;
  orderStatus: string;
  orderTradeTime: number;
  /** Locally computed, USD-ish notional (quantity * averagePrice) for ranking spikes. */
  quoteQuantity: number;
}

export type DataQualityIssue =
  | 'ws_disconnected'
  | 'ws_reconnecting'
  | 'candle_gap'
  | 'stale_open_interest'
  | 'stale_funding'
  | 'stale_liquidation_baseline'
  | 'insufficient_history';

export interface DataQuality {
  symbol: SymbolId;
  market: Market | 'combined';
  timeframe: Timeframe;
  /** 0-100, higher is better. Feeds directly into signal confidence (ASSUMPTIONS.md §10). */
  score: number;
  issues: DataQualityIssue[];
  evaluatedAt: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
