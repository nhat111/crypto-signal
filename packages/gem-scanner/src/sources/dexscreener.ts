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
  /**
   * Links the token's own team submitted to DexScreener.
   *
   * The only non-guessable source for "where is this project's site" that
   * this app has. Everything here is nullish and defaulted to empty: it is
   * absent far more often than not, and a token with no links is the
   * normal case rather than a parse failure.
   */
  info: z
    .object({
      websites: z.array(z.object({ label: z.string().nullish(), url: z.string() })).nullish(),
      socials: z.array(z.object({ type: z.string().nullish(), url: z.string() })).nullish(),
    })
    .nullish(),
});

type RawPair = z.infer<typeof pairSchema>;

/** `/tokens/v1/{chainId}/{addresses}` returns a bare array of pairs. */
const tokensResponseSchema = z.array(pairSchema);

/**
 * `/latest/dex/search?q=` wraps its results, and returns null rather than
 * an empty array when nothing matches.
 *
 * Unlike `/tokens/v1`, this endpoint does not need the chain up front —
 * which is the whole reason it is here. Somebody pasting a contract
 * address into a search box has the address and usually not the chain, and
 * asking them for it would be asking them to already know the answer.
 */
const searchResponseSchema = z.object({
  pairs: z.array(pairSchema).nullish().transform((v) => v ?? []),
});

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

  /**
   * Every pair matching a free-text query, across all chains.
   *
   * Used for one-off lookups, never by the scanner: the scan path is
   * chain-scoped and batched on purpose, and routing it through a search
   * would make its API cost depend on what somebody typed.
   */
  async searchPairs(query: string): Promise<GemPair[]> {
    const res = await fetchJsonValidated({
      url: `${this.baseUrl}/latest/dex/search?q=${encodeURIComponent(query)}`,
      schema: searchResponseSchema,
      source: this.name,
      logger: this.opts.logger,
    });
    return res.pairs.map(toGemPair);
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

function toTxnWindow(
  window: { buys: number; sells: number } | null | undefined,
): { buys: number; sells: number } | null {
  if (window == null) return null;
  // Field-by-field so TS 5.9 does not treat the z.infer object as having
  // optional buys/sells when assigning into GemPair.txns.
  return { buys: window.buys, sells: window.sells };
}

export function toGemPair(raw: RawPair): GemPair {
  return {
    chainId: raw.chainId,
    pairAddress: raw.pairAddress,
    dexId: raw.dexId,
    // Same as toTxnWindow: do not pass the z.infer nested object through.
    baseToken: {
      address: raw.baseToken.address,
      name: raw.baseToken.name,
      symbol: raw.baseToken.symbol,
    },
    quoteToken: {
      address: raw.quoteToken.address,
      symbol: raw.quoteToken.symbol,
    },
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
    txns: { h1: toTxnWindow(raw.txns?.h1), h24: toTxnWindow(raw.txns?.h24) },
    pairCreatedAt: raw.pairCreatedAt ?? null,
    url: raw.url ?? null,
    // Empty arrays rather than null: "this token submitted no links" is
    // the ordinary case, and a caller should not have to tell it apart
    // from a parse failure to render a list.
    websites: (raw.info?.websites ?? []).map((w) => ({ label: w.label ?? null, url: w.url })),
    socials: (raw.info?.socials ?? []).map((x) => ({ type: x.type ?? null, url: x.url })),
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
