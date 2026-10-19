import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';

/**
 * Bybit USDT-perpetual daily open interest, one of the venues the coin
 * scan sums OI over (see `sumDailyOpenInterest`). Public, no key.
 *
 * Shape from Bybit's v5 docs, **not verified live**: the build
 * environment is in a region Bybit's CDN blocks (403 from CloudFront).
 * `GET /v5/market/open-interest?category=linear&symbol=X&intervalTime=1d`
 * answers `{ retCode, retMsg, result: { list: [{ openInterest, timestamp }] } }`,
 * newest first, `openInterest` in the contract's base unit, `timestamp` at
 * UTC midnight. A symbol Bybit does not list is a non-zero `retCode`.
 *
 * Bybit lists some coins per 1000 units (1000PEPEUSDT), so the plain
 * symbol is tried first and the 1000x one second, scaled back to coins.
 */

const BASE_URL = 'https://api.bybit.com';

const responseSchema = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  result: z.object({ list: z.array(z.object({ openInterest: z.string(), timestamp: z.string() })).optional() }).passthrough().optional(),
});

const LISTINGS: Array<{ prefix: string; scale: number }> = [
  { prefix: '', scale: 1 },
  { prefix: '1000', scale: 1000 },
];

export interface BybitOpenInterestOptions {
  logger: Logger;
  baseUrl?: string;
}

export class BybitOpenInterest {
  readonly name = 'bybit';
  private readonly baseUrl: string;

  constructor(private readonly opts: BybitOpenInterestOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  /** Daily OI in coins of `base`, oldest first. Empty when Bybit has no USDT perpetual for it. */
  async dailyOpenInterest(base: string, points: number): Promise<Array<{ time: number; coins: number }>> {
    for (const { prefix, scale } of LISTINGS) {
      const symbol = `${prefix}${base}USDT`;
      const res = await fetchJsonValidated({
        url: `${this.baseUrl}/v5/market/open-interest?category=linear&symbol=${encodeURIComponent(symbol)}&intervalTime=1d&limit=${points}`,
        schema: responseSchema,
        source: this.name,
        logger: this.opts.logger,
        timeoutMs: 10_000,
        maxRetries: 1,
      });
      if (res.retCode !== 0) continue;
      return parseBybitOpenInterest(res.result?.list ?? [], scale);
    }
    return [];
  }
}

export function parseBybitOpenInterest(rows: Array<{ openInterest: string; timestamp: string }>, scale: number): Array<{ time: number; coins: number }> {
  return rows
    .map((r) => ({ time: Number(r.timestamp), coins: Number(r.openInterest) * scale }))
    .filter((r) => Number.isFinite(r.time) && Number.isFinite(r.coins))
    .sort((a, b) => a.time - b.time);
}
