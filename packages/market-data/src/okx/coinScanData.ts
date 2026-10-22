import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';
import type { FlowBar, Ticker24hRow } from '../types.js';

/**
 * What the wide coin scan needs, from OKX: the fallback for when Binance
 * refuses this server, which on a shared free-tier IP is most days.
 *
 * Shapes verified against the live API (2026-10):
 * - /public/instruments: `instCategory` "1" is crypto; "3" tokenized
 *   stocks (XAAPL-USDT), "4" commodities (XAUT, PAXG). Only "1" is a coin.
 * - /market/tickers: SPOT `volCcy24h` is in the quote currency; SWAP
 *   `volCcy24h` is in the base currency, so quote volume is × last.
 * - /market/candles bar=1Dutc: `[ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]`,
 *   newest first, opening at UTC midnight like Binance.
 * - /rubik/stat/taker-volume: `[ts, sellVol, buyVol]` in the base currency,
 *   summed over every spot pair of that coin, on Hong Kong days (ts at
 *   16:00 UTC), newest first, the forming day included. Order checked
 *   against Binance's taker skew on nine majors: the coins without an
 *   exchange-specific story (SOL, LINK, ZEC, ETH, DOGE) agree in sign.
 * - /rubik/stat/contracts/open-interest-history: `[ts, oi, oiCcy, oiUsd]`,
 *   `oiCcy` in coins — the unit that price alone cannot move. `period=1Dutc`
 *   puts `ts` at UTC midnight (plain `1D` is Hong Kong days), newest first.
 * - /public/funding-rate-history: objects with `fundingRate`, `fundingTime`.
 *
 * An instrument OKX does not list answers HTTP 200 with a non-zero code
 * and no data; those read as "nothing here", every other code throws.
 */

const BASE_URL = 'https://www.okx.com';
const DAY_MS = 86_400_000;
/** Hong Kong days open at 16:00 UTC the day before. */
const HK_OFFSET_MS = 8 * 60 * 60_000;
/**
 * The rubik endpoints allow 5 requests per 2 s per IP. One gate for every
 * call keeps the whole scan under that without per-endpoint bookkeeping;
 * at ~4 calls per coin, 30 coins take under a minute.
 */
const MIN_GAP_MS = 450;

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ code: z.string(), msg: z.string(), data });

const instrumentSchema = z.object({ instId: z.string(), instCategory: z.string().optional(), state: z.string() });
const tickerSchema = z.object({ instId: z.string(), last: z.string(), volCcy24h: z.string(), ts: z.string() });
// The parsers take zod's own output types rather than hand-written ones, so
// they agree with the schema under any compiler settings (see `get`).
type OkxInstrument = z.output<typeof instrumentSchema>;
type OkxTicker = z.output<typeof tickerSchema>;
const instrumentsSchema = envelope(z.array(instrumentSchema));
const tickersSchema = envelope(z.array(tickerSchema));
const rowsSchema = envelope(z.array(z.array(z.string())));
const fundingSchema = envelope(z.array(z.object({ fundingRate: z.string(), fundingTime: z.string() })));
const spotTickerSchema = envelope(z.array(z.object({ last: z.string(), sodUtc0: z.string() })));

export interface OkxCoinScanDataOptions {
  logger: Logger;
  baseUrl?: string;
  /** Test hook; production keeps the gate. */
  minGapMs?: number;
}

/** OKX speaks `BTC-USDT`; the rest of the app speaks `BTCUSDT`. */
const toSymbol = (instId: string): string => instId.replace(/-USDT(-SWAP)?$/, 'USDT');
const baseOf = (symbol: string): string => symbol.replace(/USDT$/, '');

export class OkxCoinScanData {
  readonly name = 'okx-coin-scan';
  private readonly baseUrl: string;
  private readonly minGapMs: number;
  private nextAt = 0;

  constructor(private readonly opts: OkxCoinScanDataOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.minGapMs = opts.minGapMs ?? MIN_GAP_MS;
  }

  /** USDT spot tickers for coins only — tokenized stocks and gold dropped by OKX's own category. */
  async spotTickers(): Promise<Ticker24hRow[]> {
    const [instruments, tickers] = [
      await this.get(`/api/v5/public/instruments?instType=SPOT`, instrumentsSchema),
      await this.get(`/api/v5/market/tickers?instType=SPOT`, tickersSchema),
    ];
    return parseSpotTickers(instruments ?? [], tickers ?? []);
  }

  /** USDT perpetual tickers, keyed by the same symbol as the spot pair (OKX has no 1000x listings). */
  async swapTickers(): Promise<Ticker24hRow[]> {
    return parseSwapTickers((await this.get(`/api/v5/market/tickers?instType=SWAP`, tickersSchema)) ?? []);
  }

  /** Closed UTC daily bars with OKX's spot taker split folded in — see mergeTakerVolume for what the volume fields then mean. */
  async dailyFlowBars(symbol: string, limit: number, now: number): Promise<FlowBar[]> {
    const instId = `${baseOf(symbol)}-USDT`;
    const candles = await this.get(`/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=1Dutc&limit=${Math.min(limit + 1, 300)}`, rowsSchema);
    if (!candles || candles.length === 0) return [];
    const taker = await this.get(`/api/v5/rubik/stat/taker-volume?ccy=${encodeURIComponent(baseOf(symbol))}&instType=SPOT&period=1D`, rowsSchema);
    return mergeTakerVolume(parseClosedCandles(candles, now), taker ?? []).slice(-limit);
  }

  /**
   * Daily open interest in coins, oldest first, on UTC days (`1Dutc`, the
   * forming day included) so it lines up with the other venues it is
   * summed with. Empty when OKX has no perpetual for it.
   */
  async dailyOpenInterest(symbol: string, points: number): Promise<Array<{ time: number; coins: number }>> {
    const instId = `${baseOf(symbol)}-USDT-SWAP`;
    const rows = await this.get(`/api/v5/rubik/stat/contracts/open-interest-history?instId=${encodeURIComponent(instId)}&period=1Dutc&limit=${points}`, rowsSchema);
    return parseOpenInterest(rows ?? []);
  }

  /** Funding prints since `startTime`, oldest first, as OKX printed them (per settlement period). */
  async fundingHistory(symbol: string, startTime: number): Promise<Array<{ fundingTime: number; fundingRate: number }>> {
    const instId = `${baseOf(symbol)}-USDT-SWAP`;
    const rows = await this.get(`/api/v5/public/funding-rate-history?instId=${encodeURIComponent(instId)}&limit=100`, fundingSchema);
    return (rows ?? [])
      .map((r) => ({ fundingTime: Number(r.fundingTime), fundingRate: Number(r.fundingRate) }))
      .filter((r) => r.fundingTime >= startTime && Number.isFinite(r.fundingRate))
      .sort((a, b) => a.fundingTime - b.fundingTime);
  }

  /**
   * The spot price now and at the last UTC midnight (`sodUtc0`, the open of
   * the forming daily bar, so the close of the one before). Null when OKX
   * has no spot pair for it.
   */
  async spotSinceDailyClose(symbol: string): Promise<{ last: number; dailyClose: number } | null> {
    const rows = await this.get(`/api/v5/market/ticker?instId=${encodeURIComponent(`${baseOf(symbol)}-USDT`)}`, spotTickerSchema);
    const r = rows?.[0];
    if (!r) return null;
    const last = Number(r.last);
    const dailyClose = Number(r.sodUtc0);
    return Number.isFinite(last) && Number.isFinite(dailyClose) && dailyClose > 0 ? { last, dailyClose } : null;
  }

  /** The funding rate of the period now running, as OKX prints it (per settlement period). Null when there is no perpetual. */
  async currentFunding(symbol: string): Promise<number | null> {
    const rows = await this.get(`/api/v5/public/funding-rate?instId=${encodeURIComponent(`${baseOf(symbol)}-USDT-SWAP`)}`, fundingSchema);
    const rate = Number(rows?.[0]?.fundingRate);
    return Number.isFinite(rate) ? rate : null;
  }

  /** `data`, or null when OKX says the instrument or coin is not covered. Throws on anything else. */
  // Generic over the `data` schema rather than over the envelope's output
  // type: a `ZodType<{ code: string; … }>` parameter only type-checks under
  // strictNullChecks, and Vercel's Fastify builder compiles this package
  // without it (every zod field then reads as optional), which failed the
  // API deploy while the repo's own strict typecheck passed.
  private async get<D extends z.ZodTypeAny>(
    path: string,
    schema: z.ZodObject<{ code: z.ZodString; msg: z.ZodString; data: D }>,
  ): Promise<z.output<D> | null> {
    const wait = this.nextAt - Date.now();
    this.nextAt = Math.max(Date.now(), this.nextAt) + this.minGapMs;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    const res = await fetchJsonValidated({ url: `${this.baseUrl}${path}`, schema, source: this.name, logger: this.opts.logger, timeoutMs: 15_000, maxRetries: 1 });
    if (res.code === '0') return res.data as z.output<D>;
    // 51001 "Instrument ID doesn't exist", 51012 "Token does not exist" (a
    // coin the taker-volume stats do not cover): not listed, not a failure.
    if (res.code === '51001' || res.code === '51012') return null;
    throw new Error(`OKX ${res.code}: ${res.msg} (${path.split('?')[0]})`);
  }
}

export function parseSpotTickers(instruments: OkxInstrument[], tickers: OkxTicker[]): Ticker24hRow[] {
  // A missing category (older payloads) is let through rather than
  // dropping every coin; the scan's own pegged-price check is the backstop.
  const coins = new Set(instruments.filter((i) => i.state === 'live' && (i.instCategory ?? '1') === '1').map((i) => i.instId));
  return tickers
    .filter((t) => t.instId.endsWith('-USDT') && coins.has(t.instId))
    .map((t) => ({ symbol: toSymbol(t.instId), lastPrice: Number(t.last), quoteVolume: Number(t.volCcy24h), closeTime: Number(t.ts) }));
}

export function parseSwapTickers(tickers: OkxTicker[]): Ticker24hRow[] {
  return tickers
    .filter((t) => t.instId.endsWith('-USDT-SWAP'))
    .map((t) => ({ symbol: toSymbol(t.instId), lastPrice: Number(t.last), quoteVolume: Number(t.volCcy24h) * Number(t.last), closeTime: Number(t.ts) }));
}

/** Closed daily candles, oldest first. `confirm` is ignored: a bar is closed when its day has ended, as on Binance. */
export function parseClosedCandles(rows: string[][], now: number): FlowBar[] {
  return rows
    .map((r) => {
      const [ts, o, h, l, c, vol] = r.slice(0, 6).map(Number);
      return { openTime: ts as number, closeTime: (ts as number) + DAY_MS - 1, open: o as number, high: h as number, low: l as number, close: c as number, volume: vol as number, quoteVolume: 0, takerBuyQuoteVolume: 0 };
    })
    .filter((b) => [b.openTime, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) && b.closeTime < now)
    .sort((a, b) => a.openTime - b.openTime);
}

/**
 * Folds OKX's taker split into the bars' volume fields.
 *
 * The flow read only ever takes the ratio buy / (buy + sell) summed over a
 * window, so the unit does not matter as long as every bar uses the same
 * one: here it is the base coin, across all of OKX's spot pairs for it.
 * Taker days are Hong Kong days, so each is assigned to the UTC day it
 * overlaps by 16 of its 24 hours. A bar with no taker row keeps zeros and
 * drops out of the sum; a window with none at all reads as unknown.
 */
export function mergeTakerVolume(bars: FlowBar[], takerRows: string[][]): FlowBar[] {
  const byUtcDay = new Map<number, { buy: number; sell: number }>();
  for (const r of takerRows) {
    const ts = Number(r[0]);
    const sell = Number(r[1]);
    const buy = Number(r[2]);
    if (![ts, sell, buy].every(Number.isFinite)) continue;
    const utcDay = Math.floor((ts + HK_OFFSET_MS) / DAY_MS) * DAY_MS;
    byUtcDay.set(utcDay, { buy, sell });
  }
  return bars.map((b) => {
    const t = byUtcDay.get(b.openTime);
    return t ? { ...b, quoteVolume: t.buy + t.sell, takerBuyQuoteVolume: t.buy } : b;
  });
}

/** OKX's `[ts, oi, oiCcy, oiUsd]` rows as coins per day, oldest first. */
export function parseOpenInterest(rows: string[][]): Array<{ time: number; coins: number }> {
  return rows
    .map((r) => ({ time: Number(r[0]), coins: Number(r[2]) }))
    .filter((r) => Number.isFinite(r.time) && Number.isFinite(r.coins))
    .sort((a, b) => a.time - b.time);
}
