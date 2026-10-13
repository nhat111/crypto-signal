import type { Candle, Logger, SymbolId, Timeframe } from '@crypto-signal/shared';
import type { ConnectionStatus, DailyBar, ExchangeAdapter, FlowBar, KlineQuery, Ticker24hRow, Unsubscribe } from '../types.js';
import { closedDailyBars, closedFlowBars, rawKlineToCandle, rawTickerToTicker, wsKlineToCandle, type RawTicker24h, type WsKlinePayload } from '../normalizer.js';
import { BinanceRestClient } from './rest.js';
import { CombinedStreamClient } from './ws.js';
import { klineStreamName, timeframeFromKlineStream } from './stream-names.js';

export interface BinanceSpotAdapterOptions {
  restBase: string;
  wsBase: string;
  logger: Logger;
}

export class BinanceSpotAdapter implements ExchangeAdapter {
  readonly market = 'spot' as const;
  private readonly rest: BinanceRestClient;

  constructor(private readonly opts: BinanceSpotAdapterOptions) {
    this.rest = new BinanceRestClient({
      baseUrl: opts.restBase,
      klinesPath: '/api/v3/klines',
      logger: opts.logger,
    });
  }

  async fetchKlines(symbol: SymbolId, timeframe: Timeframe, opts: KlineQuery = {}): Promise<Candle[]> {
    const raw = await this.rest.getKlines(symbol, timeframe, opts);
    return raw.map((r) => rawKlineToCandle(r, symbol, this.market, timeframe));
  }

  /**
   * Daily bars for the 1D structure read. Not a collected timeframe — it is
   * fetched on demand, a few requests a day — so it skips the Candle type
   * and returns only bars that have CLOSED: the one still forming would let
   * an intraday dip read as a broken structure.
   */
  async fetchClosedDailyBars(symbol: SymbolId, limit = 400, now = Date.now()): Promise<DailyBar[]> {
    return this.fetchClosedBars(symbol, '1d', limit, now);
  }

  /** Same, for any Binance interval — the setup scan reads 4h straight from the exchange so a gap in the collector's own candles cannot hide a setup. */
  async fetchClosedBars(symbol: SymbolId, interval: string, limit: number, now = Date.now()): Promise<DailyBar[]> {
    const raw = await this.rest.getKlines(symbol, interval, { limit });
    return closedDailyBars(raw, now);
  }

  /** Closed bars with quote and taker-buy volume, for the wide coin scan's flow read. */
  async fetchClosedFlowBars(symbol: SymbolId, interval: string, limit: number, now = Date.now()): Promise<FlowBar[]> {
    const raw = await this.rest.getKlines(symbol, interval, { limit });
    return closedFlowBars(raw, now);
  }

  /** Every spot pair's 24h ticker in one request (weight 80) — how the coin scan finds the most-traded coins. */
  async fetch24hTickers(): Promise<Ticker24hRow[]> {
    const raw = await this.rest.get<RawTicker24h[]>('/api/v3/ticker/24hr');
    return raw.map(rawTickerToTicker);
  }

  subscribeKlines(
    symbols: SymbolId[],
    timeframes: Timeframe[],
    onCandle: (candle: Candle) => void,
    onStatus?: (status: ConnectionStatus) => void,
  ): Unsubscribe {
    const streams = symbols.flatMap((symbol) => timeframes.map((tf) => klineStreamName(symbol, tf)));

    const client = new CombinedStreamClient({
      name: 'spot-klines',
      baseWsUrl: this.opts.wsBase,
      streams,
      logger: this.opts.logger,
      onStatus,
      onMessage: (streamName, data) => {
        const timeframe = timeframeFromKlineStream(streamName);
        if (!timeframe) return;
        const payload = data as { s: string; k: WsKlinePayload };
        const candle = wsKlineToCandle(payload.k, payload.s, this.market, timeframe);
        if (candle) onCandle(candle);
      },
    });

    client.connect();
    return () => client.close();
  }
}
