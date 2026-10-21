import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';

/**
 * DefiLlama's protocol list — the free, keyless source behind the airdrop
 * research list. Every protocol DefiLlama tracks, with its token (if any),
 * TVL and 1d/7d TVL change. A protocol with TVL and no token is the raw
 * material: that is the shape of every project that later paid users an
 * airdrop, and also of plenty that never will (ASSUMPTIONS.md §25).
 *
 * Funding rounds would be the other obvious input, but `/raises` is behind
 * DefiLlama's paid plan (HTTP 402), so it is not used.
 *
 * The payload is ~9 MB covering ~9,000 protocols. The boundary only checks
 * that it is an array; each row is then parsed on its own, so one oddly
 * shaped protocol is dropped instead of failing the whole day.
 */

const protocolSchema = z.object({
  name: z.string(),
  slug: z.string(),
  symbol: z.string().nullish(),
  gecko_id: z.string().nullish(),
  cmcId: z.union([z.string(), z.number()]).nullish(),
  category: z.string().nullish(),
  chains: z.array(z.string()).nullish(),
  tvl: z.number().nullish(),
  change_1d: z.number().nullish(),
  change_7d: z.number().nullish(),
  url: z.string().nullish(),
  twitter: z.string().nullish(),
  logo: z.string().nullish(),
  audits: z.union([z.string(), z.number()]).nullish(),
  listedAt: z.number().nullish(),
  parentProtocolSlug: z.string().nullish(),
  deprecated: z.boolean().nullish(),
  rugged: z.boolean().nullish(),
  deadUrl: z.boolean().nullish(),
  stablecoins: z.array(z.string()).nullish(),
});

export type LlamaProtocol = z.infer<typeof protocolSchema>;

const BASE_URL = 'https://api.llama.fi';

export interface DefiLlamaProtocolOptions {
  logger: Logger;
  baseUrl?: string;
}

export interface ProtocolFetch {
  protocols: LlamaProtocol[];
  /** Rows that did not parse. Logged, not fatal; a large number means the shape changed. */
  dropped: number;
}

export class DefiLlamaProtocolSource {
  readonly name = 'defillama-protocols';
  private readonly baseUrl: string;

  constructor(private readonly opts: DefiLlamaProtocolOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  async fetchProtocols(): Promise<ProtocolFetch> {
    const raw = await fetchJsonValidated({
      url: `${this.baseUrl}/protocols`,
      schema: z.array(z.unknown()),
      source: this.name,
      logger: this.opts.logger,
      timeoutMs: 60_000,
    });
    return parseProtocols(raw);
  }
}

export function parseProtocols(raw: unknown[]): ProtocolFetch {
  const protocols: LlamaProtocol[] = [];
  let dropped = 0;
  for (const row of raw) {
    const parsed = protocolSchema.safeParse(row);
    if (parsed.success) protocols.push(parsed.data);
    else dropped += 1;
  }
  return { protocols, dropped };
}
