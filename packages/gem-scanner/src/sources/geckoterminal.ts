import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';
import type { CandidateDiscoverySource, ChainId, GemCandidate } from '../types.js';


/**
 * GeckoTerminal adapter — **discovery only**.
 *
 * It exists to counterbalance sampling bias: DexScreener's profile/boost
 * feeds list tokens whose teams paid for marketing, which is a specific
 * (and self-selecting) slice of the chain. GeckoTerminal's top-pools
 * ranking is volume-ordered instead, so together they cover more of what's
 * actually trading. Both are still samples — see ASSUMPTIONS.md §16.
 *
 * It deliberately does not implement PairDataSource: every scored metric
 * comes from DexScreener so the numbers being compared share one
 * definition.
 *
 * Endpoints/field names are from GeckoTerminal's public API docs and could
 * not be probed from the build environment, so responses are
 * schema-validated at the boundary.
 */

/** JSON:API envelope: relationships.base_token.data.id looks like "solana_<address>". */
const poolsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      relationships: z
        .object({
          base_token: z.object({ data: z.object({ id: z.string() }) }).nullish(),
        })
        .nullish(),
    }),
  ),
});

const BASE_URL = 'https://api.geckoterminal.com/api/v2';

/** Free tier is documented at 30 calls/min, so this stays deliberately small. */
const DEFAULT_PAGES = 2;

export interface GeckoTerminalOptions {
  logger: Logger;
  baseUrl?: string;
  /** How many pages of top pools to walk. Each page is one API call. */
  pages?: number;
}

export class GeckoTerminalSource implements CandidateDiscoverySource {
  readonly name = 'geckoterminal';
  private readonly baseUrl: string;
  private readonly pages: number;

  constructor(private readonly opts: GeckoTerminalOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.pages = opts.pages ?? DEFAULT_PAGES;
  }

  async discoverCandidates(chainId: ChainId): Promise<GemCandidate[]> {
    const network = toGeckoNetwork(chainId);
    if (!network) {
      this.opts.logger.warn({ chainId }, 'no GeckoTerminal network mapping for this chain, skipping this discovery source');
      return [];
    }

    const candidates = new Map<string, GemCandidate>();

    for (let page = 1; page <= this.pages; page += 1) {
      try {
        const res = await fetchJsonValidated({
          url: `${this.baseUrl}/networks/${network}/pools?page=${page}`,
          schema: poolsResponseSchema,
          source: this.name,
          logger: this.opts.logger,
        });

        for (const pool of res.data) {
          const tokenId = pool.relationships?.base_token?.data.id;
          const address = tokenId ? stripNetworkPrefix(tokenId, network) : null;
          if (address && !candidates.has(address)) {
            candidates.set(address, { chainId, tokenAddress: address, source: 'geckoterminal_top_pools' });
          }
        }
      } catch (err) {
        this.opts.logger.warn({ err, page }, 'geckoterminal top-pools page failed, continuing');
      }
    }

    return [...candidates.values()];
  }
}

/**
 * DexScreener and GeckoTerminal use different network slugs. Only chains
 * we've actually confirmed a mapping for are listed — an unmapped chain
 * skips this source rather than guessing a slug that would 404.
 */
const GECKO_NETWORK_BY_CHAIN: Record<string, string> = {
  solana: 'solana',
};

export function toGeckoNetwork(chainId: ChainId): string | null {
  return GECKO_NETWORK_BY_CHAIN[chainId] ?? null;
}

export function stripNetworkPrefix(tokenId: string, network: string): string {
  const prefix = `${network}_`;
  return tokenId.startsWith(prefix) ? tokenId.slice(prefix.length) : tokenId;
}
