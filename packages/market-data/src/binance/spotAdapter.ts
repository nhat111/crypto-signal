import type { Candle, Logger, SymbolId, Timeframe } from '@crypto-signal/shared';
import type { ConnectionStatus, DailyBar, ExchangeAdapter, KlineQuery, Unsubscribe } from '../types.js';
import { closedDailyBars, rawKlineToCandle, wsKlineToCandle, type WsKlinePayload } from '../normalizer.js';
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
    const raw = await this.rest.getKlines(symbol, '1d', { limit });
    return closedDailyBars(raw, now);
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
