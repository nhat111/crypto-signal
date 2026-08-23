import type {
  Candle,
  FundingRatePoint,
  LiquidationEvent,
  MarkPriceSnapshot,
  Market,
  OpenInterestPoint,
  SymbolId,
  Timeframe,
} from '@crypto-signal/shared';

/**
 * Minimal surface the pipeline actually calls. A second exchange (Bybit/OKX)
 * becomes additive by implementing this interface — see ASSUMPTIONS.md §11.
 * We deliberately did not model order books, account data, or trading — out
 * of scope for a read-only health monitor.
 */
export interface ExchangeAdapter {
  readonly market: Market;
  fetchKlines(symbol: SymbolId, timeframe: Timeframe, opts?: KlineQuery): Promise<Candle[]>;
  subscribeKlines(
    symbols: SymbolId[],
    timeframes: Timeframe[],
    onCandle: (candle: Candle) => void,
    onStatus?: (status: ConnectionStatus) => void,
  ): Unsubscribe;
}

export interface FuturesAdapter extends ExchangeAdapter {
  fetchOpenInterestHist(symbol: SymbolId, timeframe: Timeframe, opts?: { limit?: number; startTime?: number; endTime?: number }): Promise<OpenInterestPoint[]>;
  fetchCurrentOpenInterest(symbol: SymbolId): Promise<{ symbol: SymbolId; openInterest: number; time: number }>;
  fetchFundingRateHistory(symbol: SymbolId, opts?: { limit?: number; startTime?: number; endTime?: number }): Promise<FundingRatePoint[]>;
  fetchPremiumIndex(symbol: SymbolId): Promise<MarkPriceSnapshot>;
  subscribeLiquidations(symbols: SymbolId[], onLiquidation: (event: LiquidationEvent) => void, onStatus?: (status: ConnectionStatus) => void): Unsubscribe;
}

export interface KlineQuery {
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export type Unsubscribe = () => void;

export type ConnectionStatus =
  | { state: 'connecting' }
  | { state: 'open' }
  | { state: 'closed'; code: number; reason: string }
  | { state: 'reconnecting'; attempt: number; delayMs: number }
  | { state: 'error'; message: string };
