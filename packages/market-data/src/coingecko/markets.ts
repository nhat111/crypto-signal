import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';

/**
 * CoinGecko `/coins/markets`: price, market cap and 7d/30d change, for
 * the coins of one category or for a list of ids. Used by the sector read
 * (which mảng money is moving into) and to price the flywheel list.
 *
 * Free. Without a key the public API allows a handful of calls a minute
 * per IP, and Render's IP is shared, so callers pace their requests and
 * treat a failed category as missing rather than fatal. A free "demo" key
 * (`COINGECKO_API_KEY`) raises the limit and goes in a header on the same
 * host. Shapes verified against the live API (2026-10).
 */

const BASE_URL = 'https://api.coingecko.com/api/v3';

const marketSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string(),
  current_price: z.number().nullable().optional(),
  market_cap: z.number().nullable().optional(),
  price_change_percentage_7d_in_currency: z.number().nullable().optional(),
  price_change_percentage_30d_in_currency: z.number().nullable().optional(),
});

export interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
}

export interface CoinGeckoOptions {
  logger: Logger;
  apiKey?: string;
  baseUrl?: string;
}

export class CoinGeckoMarkets {
  readonly name = 'coingecko-markets';
  private readonly baseUrl: string;

  constructor(private readonly opts: CoinGeckoOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  /** The category's largest coins by market cap. */
  fetchCategory(categoryId: string, perPage = 30): Promise<CoinMarket[]> {
    const qs = new URLSearchParams({
      vs_currency: 'usd',
      category: categoryId,
      order: 'market_cap_desc',
      per_page: String(Math.min(250, Math.max(1, perPage))),
      page: '1',
      price_change_percentage: '7d,30d',
    });
    return this.fetch(`/coins/markets?${qs.toString()}`);
  }

  /** Up to 250 ids per call; the caller splits longer lists. */
  fetchIds(ids: readonly string[]): Promise<CoinMarket[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const qs = new URLSearchParams({
      vs_currency: 'usd',
      ids: ids.slice(0, 250).join(','),
      per_page: '250',
      page: '1',
      price_change_percentage: '7d,30d',
    });
    return this.fetch(`/coins/markets?${qs.toString()}`);
  }

  private async fetch(path: string): Promise<CoinMarket[]> {
    const raw = await fetchJsonValidated({
      url: `${this.baseUrl}${path}`,
      schema: z.array(z.unknown()),
      source: this.name,
      logger: this.opts.logger,
      timeoutMs: 20_000,
      headers: this.opts.apiKey ? { 'x-cg-demo-api-key': this.opts.apiKey } : undefined,
    });
    return parseMarkets(raw);
  }
}

/** Rows that do not fit are dropped one by one, never the whole list. */
export function parseMarkets(raw: unknown[]): CoinMarket[] {
  const out: CoinMarket[] = [];
  for (const row of raw) {
    const parsed = marketSchema.safeParse(row);
    if (!parsed.success) continue;
    const r = parsed.data;
    out.push({
      id: r.id,
      symbol: r.symbol.toUpperCase(),
      name: r.name,
      priceUsd: r.current_price ?? null,
      marketCapUsd: r.market_cap ?? null,
      change7dPct: r.price_change_percentage_7d_in_currency ?? null,
      change30dPct: r.price_change_percentage_30d_in_currency ?? null,
    });
  }
  return out;
}
