import type { Pool } from 'pg';
import type { AppConfig, Logger, SymbolId } from '@crypto-signal/shared';
import type { BinanceFuturesAdapter, BinanceSpotAdapter, ConnectionStatus } from '@crypto-signal/market-data';
import type { SignalType } from '@crypto-signal/signal-engine';
import type { GemConfig } from '@crypto-signal/gem-scanner';
import type { SignalVerdict } from '@crypto-signal/db';
import { TelegramNotifier } from './telegramNotifier.js';
import { CandlePairBuffer, SymbolTimeframeState, stateKey } from './state.js';

export type MarketConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface WorkerContext {
  pool: Pool;
  notifier: TelegramNotifier;
  logger: Logger;
  config: AppConfig;
  spotAdapter: BinanceSpotAdapter;
  futuresAdapter: BinanceFuturesAdapter;
  states: Map<string, SymbolTimeframeState>;
  pairBuffer: CandlePairBuffer;
  /** Symbols with only a Binance Futures listing — routed straight to processFuturesOnlyCandle, never through pairBuffer (there's no spot side to wait for). */
  futuresOnlySymbolSet: Set<SymbolId>;
  /**
   * Epoch millis of the last candle received per symbol, stamped before
   * any processing. Separates "the candles stopped coming" from "they
   * come and something drops them" — indistinguishable otherwise, because
   * the only other signal is the snapshot, which needs the whole pipeline
   * to have worked.
   */
  symbolIngest: Record<string, number>;
  connectionStatus: {
    spot: MarketConnectionState;
    futures: MarketConnectionState;
    liquidation: MarketConnectionState;
  };
  historicalScores: Map<SignalType, number>;
  /**
   * What the recorded outcomes have concluded about each signal type,
   * refreshed hourly. Held in memory for the same reason historicalScores
   * is: an alert must not wait on a lateral join across every candle in
   * the measured window just to decide whether to add a warning line.
   * Empty until the first refresh completes, which reads as "nothing
   * concluded yet" — the correct thing to say on a fresh deploy.
   */
  signalVerdicts: Map<SignalType, SignalVerdict>;
  /** Null when small-cap discovery is disabled — it's an opt-in, independent subsystem (ASSUMPTIONS.md §16). */
  gemConfig: GemConfig | null;
}

export function connectionStatusToState(status: ConnectionStatus): MarketConnectionState {
  switch (status.state) {
    case 'open':
      return 'open';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'closed':
      return 'closed';
    case 'error':
      return 'error';
  }
}

export function buildStates(symbols: SymbolId[], timeframes: WorkerContext['config']['timeframes']): Map<string, SymbolTimeframeState> {
  const states = new Map<string, SymbolTimeframeState>();
  for (const symbol of symbols) {
    for (const timeframe of timeframes) {
      states.set(stateKey(symbol, timeframe), new SymbolTimeframeState(symbol, timeframe));
    }
  }
  return states;
}
