import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';
import type { CandidateSource, ChainId, GemCandidate, GemPair, MarketDataSource } from '../types.js';


/**
 * DexScreener adapter.
 *
 * Endpoint paths and field names below come from DexScreener's public API
 * documentation. They could NOT be verified live from the build
 * environment (egress-blocked — ASSUMPTIONS.md §16), so every response is
 * schema-validated at the boundary and fails loudly rather than silently
 * scoring `undefined`.
 *
 * Notably, the public API has no "list every pair on a chain filtered by
 * liquidity" endpoint — the website's screener filters aren't exposed. So
 * discovery works as candidate-feed + enrichment: cheap feeds give token
 * addresses, then `/tokens/v1` fetches full pair data for them in batches.
 * That means the scanner sees a *sample* of the chain, never all of it —
 * a limitation that is surfaced in the UI, not hidden.
 */

const numericString = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });

const txnWindowSchema = z
  .object({ buys: z.number(), sells: z.number() })
  .nullish()
  .transform((v) => v ?? null);

const pairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  pairAddress: z.string(),
  url: z.string().nullish(),
  baseToken: z.object({ address: z.string(), name: z.string(), symbol: z.string() }),
  quoteToken: z.object({ address: z.string(), symbol: z.string() }),
  priceUsd: numericString,
  liquidity: z.object({ usd: numericString }).nullish(),
  fdv: numericString,
  marketCap: numericString,
  volume: z.object({ h1: numericString, h6: numericString, h24: numericString }).nullish(),
  priceChange: z.object({ m5: numericString, h1: numericString, h6: numericString, h24: numericString }).nullish(),
  txns: z.object({ h1: txnWindowSchema, h24: txnWindowSchema }).nullish(),
  pairCreatedAt: z.number().nullish(),
});

type RawPair = z.infer<typeof pairSchema>;

/** `/tokens/v1/{chainId}/{addresses}` returns a bare array of pairs. */
const tokensResponseSchema = z.array(pairSchema);

/** Token profile / boost feeds share a `tokenAddress` + `chainId` shape. */
const tokenFeedSchema = z.array(
  z.object({
    chainId: z.string(),
    tokenAddress: z.string(),
  }),
);

const BASE_URL = 'https://api.dexscreener.com';

/** `/tokens/v1` accepts a comma-separated list; the documented cap is 30 addresses per call. */
const MAX_ADDRESSES_PER_REQUEST = 30;

export interface DexScreenerOptions {
  logger: Logger;
  baseUrl?: string;
}

export class DexScreenerSource implements MarketDataSource {
  readonly name = 'dexscreener';
  private readonly baseUrl: string;

  constructor(private readonly opts: DexScreenerOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  async discoverCandidates(chainId: ChainId): Promise<GemCandidate[]> {
    const feeds: Array<{ path: string; source: CandidateSource }> = [
      { path: '/token-profiles/latest/v1', source: 'dexscreener_profiles' },
      { path: '/token-boosts/latest/v1', source: 'dexscreener_boosts' },
    ];

    const candidates = new Map<string, GemCandidate>();

    for (const feed of feeds) {
      try {
        const rows = await fetchJsonValidated({
          url: `${this.baseUrl}${feed.path}`,
          schema: tokenFeedSchema,
          source: this.name,
          logger: this.opts.logger,
        });
        for (const row of rows) {
          if (row.chainId !== chainId) continue;
          // Deduped across feeds; first source seen wins, so a token that is
          // both profiled and boosted isn't counted twice.
          if (!candidates.has(row.tokenAddress)) {
            candidates.set(row.tokenAddress, { chainId, tokenAddress: row.tokenAddress, source: feed.source });
          }
        }
      } catch (err) {
        // One dead feed shouldn't kill the whole scan — the others still
        // produce candidates, and the scan reports how many it saw.
        this.opts.logger.warn({ err, feed: feed.path }, 'dexscreener candidate feed failed, continuing with the others');
      }
    }

    return [...candidates.values()];
  }

  async fetchPairsForTokens(chainId: ChainId, tokenAddresses: string[]): Promise<GemPair[]> {
    const pairs: GemPair[] = [];

    for (const batch of chunk(tokenAddresses, MAX_ADDRESSES_PER_REQUEST)) {
      const url = `${this.baseUrl}/tokens/v1/${encodeURIComponent(chainId)}/${batch.map(encodeURIComponent).join(',')}`;
      try {
        const raw = await fetchJsonValidated({
          url,
          schema: tokensResponseSchema,
          source: this.name,
          logger: this.opts.logger,
        });
        for (const p of raw) pairs.push(toGemPair(p));
      } catch (err) {
        this.opts.logger.warn({ err, batchSize: batch.length }, 'dexscreener token batch failed, skipping this batch');
      }
    }

    return pairs;
  }
}

export function toGemPair(raw: RawPair): GemPair {
  return {
    chainId: raw.chainId,
    pairAddress: raw.pairAddress,
    dexId: raw.dexId,
    baseToken: raw.baseToken,
    quoteToken: raw.quoteToken,
    priceUsd: raw.priceUsd,
    liquidityUsd: raw.liquidity?.usd ?? null,
    fdvUsd: raw.fdv,
    marketCapUsd: raw.marketCap,
    volume: { h1: raw.volume?.h1 ?? null, h6: raw.volume?.h6 ?? null, h24: raw.volume?.h24 ?? null },
    priceChangePct: {
      m5: raw.priceChange?.m5 ?? null,
      h1: raw.priceChange?.h1 ?? null,
      h6: raw.priceChange?.h6 ?? null,
      h24: raw.priceChange?.h24 ?? null,
    },
    txns: { h1: raw.txns?.h1 ?? null, h24: raw.txns?.h24 ?? null },
    pairCreatedAt: raw.pairCreatedAt ?? null,
    url: raw.url ?? null,
    fetchedAt: Date.now(),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Exported for tests — lets the pair-normalization logic be exercised without a network call. */
export const __testing = { pairSchema, tokensResponseSchema, tokenFeedSchema };
