import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';

/**
 * OKX spot candles: the fallback for a Lookup when Binance refuses this
 * server.
 *
 * Free hosts share their outbound IPs, so Binance can ban the server for
 * somebody else's traffic (418) and a Lookup then has nothing to read.
 * OKX lists most of the same USDT pairs and serves candles without a key.
 * Only Lookup uses this: the collector, signals and performance numbers
 * stay Binance-only, so nothing scored ever mixes two exchanges.
 *
 * Shape verified against the live API: `data` is newest first, each row
 * `[ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]` as strings, `vol`
 * in the base asset (same unit as Binance's kline volume). An unknown
 * instrument is HTTP 200 with code "51001" and empty data.
 */

const responseSchema = z.object({
  code: z.string(),
  msg: z.string(),
  data: z.array(z.array(z.string())),
});

const BASE_URL = 'https://www.okx.com';

/** "Instrument ID ... doesn't exist" — the pair is not listed on OKX. */
const UNKNOWN_INSTRUMENT = '51001';

/** OKX caps /market/candles at 300 rows. */
const MAX_LIMIT = 300;

/**
 * Binance interval → OKX bar. `1Dutc` rather than `1D`: OKX's plain daily
 * bar opens at Hong Kong midnight, Binance's at UTC midnight. Hourly bars
 * line up on both (UTC+8 is a whole number of 4h steps).
 */
const BAR: Record<string, string> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1Dutc',
};

/** Quotes Lookup tries, longest first so FDUSD is not read as ...USD. */
const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BTC', 'ETH'];

export interface OkxBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OkxSpotCandlesOptions {
  logger: Logger;
  baseUrl?: string;
}

/** `NEARUSDT` → `NEAR-USDT`, or null when no known quote asset ends the symbol. */
export function toOkxInstId(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  const quote = QUOTES.find((q) => upper.endsWith(q) && upper.length > q.length);
  return quote ? `${upper.slice(0, -quote.length)}-${quote}` : null;
}

export class OkxSpotCandles {
  readonly name = 'okx-spot-candles';
  private readonly baseUrl: string;

  constructor(private readonly opts: OkxSpotCandlesOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  /**
   * Bars oldest first, the forming one included (as Binance's klines do).
   * Empty when OKX does not list the pair, so the caller can tell
   * "not listed here" from a failure, which throws.
   */
  async fetchBars(symbol: string, interval: string, limit: number): Promise<OkxBar[]> {
    const instId = toOkxInstId(symbol);
    const bar = BAR[interval];
    if (instId === null || bar === undefined) return [];

    const url = `${this.baseUrl}/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${bar}&limit=${Math.min(limit, MAX_LIMIT)}`;
    const res = await fetchJsonValidated({
      url,
      schema: responseSchema,
      source: this.name,
      logger: this.opts.logger,
      timeoutMs: 10_000,
      maxRetries: 1,
    });

    if (res.code === UNKNOWN_INSTRUMENT) return [];
    if (res.code !== '0') throw new Error(`OKX ${res.code}: ${res.msg}`);

    return res.data
      .map(toOkxBar)
      .filter((b): b is OkxBar => b !== null)
      .sort((a, b) => a.openTime - b.openTime);
  }
}

export function toOkxBar(row: string[]): OkxBar | null {
  const [ts, o, h, l, c, vol] = row.map(Number);
  const values = [ts, o, h, l, c, vol];
  if (values.some((v) => v === undefined || !Number.isFinite(v))) return null;
  return { openTime: ts!, open: o!, high: h!, low: l!, close: c!, volume: vol! };
}
