import type {
  Candle,
  FundingRatePoint,
  LiquidationEvent,
  Logger,
  MarkPriceSnapshot,
  OpenInterestPoint,
  SymbolId,
  Timeframe,
} from '@crypto-signal/shared';
import { timeframeToOpenInterestPeriod } from '@crypto-signal/shared';
import type { ConnectionStatus, FuturesAdapter, KlineQuery, Unsubscribe } from '../types.js';
import { forceOrderToLiquidation, rawKlineToCandle, wsKlineToCandle, type ForceOrderPayload, type WsKlinePayload } from '../normalizer.js';
import { BinanceRestClient } from './rest.js';
import { CombinedStreamClient } from './ws.js';
import { KLINE_STREAM_STALE_MS } from '../streamHealth.js';
import { forceOrderStreamName, klineStreamName, timeframeFromKlineStream } from './stream-names.js';

export interface BinanceFuturesAdapterOptions {
  restBase: string;
  wsBase: string;
  logger: Logger;
}

interface RawOpenInterestHist {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}

interface RawFundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice?: string;
}

interface RawPremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  time: number;
}

interface RawOpenInterest {
  symbol: string;
  openInterest: string;
  time: number;
}

export class BinanceFuturesAdapter implements FuturesAdapter {
  readonly market = 'futures' as const;
  private readonly rest: BinanceRestClient;

  constructor(private readonly opts: BinanceFuturesAdapterOptions) {
    this.rest = new BinanceRestClient({
      baseUrl: opts.restBase,
      klinesPath: '/fapi/v1/klines',
      logger: opts.logger,
    });
  }

  async fetchKlines(symbol: SymbolId, timeframe: Timeframe, opts: KlineQuery = {}): Promise<Candle[]> {
    const raw = await this.rest.getKlines(symbol, timeframe, opts);
    return raw.map((r) => rawKlineToCandle(r, symbol, this.market, timeframe));
  }

  subscribeKlines(
    symbols: SymbolId[],
    timeframes: Timeframe[],
    onCandle: (candle: Candle) => void,
    onStatus?: (status: ConnectionStatus) => void,
  ): Unsubscribe {
    const streams = symbols.flatMap((symbol) => timeframes.map((tf) => klineStreamName(symbol, tf)));

    const client = new CombinedStreamClient({
      name: 'futures-klines',
      baseWsUrl: this.opts.wsBase,
      streams,
      logger: this.opts.logger,
      onStatus,
      // Klines are pushed continuously on every timeframe, so one symbol
      // going quiet inside a busy socket is a fault the connection-level
      // watchdog cannot see (see streamHealth.ts).
      perStreamStaleMs: KLINE_STREAM_STALE_MS,
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

  async fetchOpenInterestHist(
    symbol: SymbolId,
    timeframe: Timeframe,
    opts: { limit?: number; startTime?: number; endTime?: number } = {},
  ): Promise<OpenInterestPoint[]> {
    const period = timeframeToOpenInterestPeriod(timeframe);
    const raw = await this.rest.get<RawOpenInterestHist[]>('/futures/data/openInterestHist', {
      symbol,
      period,
      limit: opts.limit,
      startTime: opts.startTime,
      endTime: opts.endTime,
    });
    return raw.map((r) => ({
      symbol: r.symbol,
      timeframe,
      timestamp: r.timestamp,
      sumOpenInterest: Number(r.sumOpenInterest),
      sumOpenInterestValue: Number(r.sumOpenInterestValue),
    }));
  }

  async fetchCurrentOpenInterest(symbol: SymbolId): Promise<{ symbol: SymbolId; openInterest: number; time: number }> {
    const raw = await this.rest.get<RawOpenInterest>('/fapi/v1/openInterest', { symbol });
    return { symbol: raw.symbol, openInterest: Number(raw.openInterest), time: raw.time };
  }

  async fetchFundingRateHistory(
    symbol: SymbolId,
    opts: { limit?: number; startTime?: number; endTime?: number } = {},
  ): Promise<FundingRatePoint[]> {
    const raw = await this.rest.get<RawFundingRate[]>('/fapi/v1/fundingRate', {
      symbol,
      limit: opts.limit,
      startTime: opts.startTime,
      endTime: opts.endTime,
    });
    return raw.map((r) => ({
      symbol: r.symbol,
      fundingTime: r.fundingTime,
      fundingRate: Number(r.fundingRate),
      markPrice: r.markPrice !== undefined ? Number(r.markPrice) : null,
    }));
  }

  async fetchPremiumIndex(symbol: SymbolId): Promise<MarkPriceSnapshot> {
    const raw = await this.rest.get<RawPremiumIndex>('/fapi/v1/premiumIndex', { symbol });
    return {
      symbol: raw.symbol,
      markPrice: Number(raw.markPrice),
      indexPrice: Number(raw.indexPrice),
      lastFundingRate: Number(raw.lastFundingRate),
      nextFundingTime: raw.nextFundingTime,
      time: raw.time,
    };
  }

  subscribeLiquidations(
    symbols: SymbolId[],
    onLiquidation: (event: LiquidationEvent) => void,
    onStatus?: (status: ConnectionStatus) => void,
  ): Unsubscribe {
    const streams = symbols.map((symbol) => forceOrderStreamName(symbol));

    const client = new CombinedStreamClient({
      name: 'futures-liquidations',
      baseWsUrl: this.opts.wsBase,
      streams,
      logger: this.opts.logger,
      onStatus,
      onMessage: (_streamName, data) => {
        onLiquidation(forceOrderToLiquidation(data as ForceOrderPayload));
      },
    });

    client.connect();
    return () => client.close();
  }
}
