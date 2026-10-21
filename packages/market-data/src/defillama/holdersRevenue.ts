import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';

/**
 * DefiLlama's "holders revenue": what a protocol or chain paid out to the
 * holders of its token in the last 30 days, through buybacks, burns or fee
 * sharing (Hyperliquid's buyback of HYPE, veCRV's share of Curve's fees,
 * ETH's base-fee burn). This is the flywheel the reader is looking for:
 * the product's own cash flow coming back to the token.
 *
 * Plus the two lists needed to put a token and a market cap on each row:
 * `lite/protocols2` (protocols and their parents, with CoinGecko ids and
 * DefiLlama's market cap) and `/v2/chains` (a chain's CoinGecko id).
 * Free and keyless; ~2 MB, ~7 MB and ~0.3 MB. Shapes verified live
 * (2026-10). Rows that do not fit are dropped one by one.
 */

const API = 'https://api.llama.fi';

const feeRowSchema = z.object({
  name: z.string(),
  displayName: z.string().nullish(),
  defillamaId: z.string().nullish(),
  slug: z.string().nullish(),
  category: z.string().nullish(),
  protocolType: z.string().nullish(),
  parentProtocol: z.string().nullish(),
  total30d: z.number().nullish(),
  total60dto30d: z.number().nullish(),
  methodology: z.record(z.unknown()).nullish(),
});

const liteProtocolSchema = z.object({
  name: z.string(),
  defillamaId: z.string().nullish(),
  symbol: z.string().nullish(),
  geckoId: z.string().nullish(),
  mcap: z.number().nullish(),
});

const parentSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbol: z.string().nullish(),
  gecko_id: z.string().nullish(),
  mcap: z.number().nullish(),
});

const chainSchema = z.object({
  name: z.string(),
  gecko_id: z.string().nullish(),
  tokenSymbol: z.string().nullish(),
});

export interface HoldersRevenueRow {
  name: string;
  /** "chain#tron" for chains, a number for protocols. */
  defillamaId: string | null;
  slug: string | null;
  category: string | null;
  isChain: boolean;
  parentProtocol: string | null;
  total30d: number | null;
  total60dto30d: number | null;
  /** DefiLlama's own one-line description of where holders revenue comes from. */
  mechanism: string | null;
}

export interface TokenRef {
  name: string;
  symbol: string | null;
  geckoId: string | null;
  mcapUsd: number | null;
}

export interface TokenDirectory {
  /** By protocol `defillamaId`. */
  protocols: Map<string, TokenRef>;
  /** By parent id, "parent#hyperliquid". */
  parents: Map<string, TokenRef>;
  /** By chain name, "Tron". */
  chains: Map<string, TokenRef>;
}

function cleanSymbol(symbol: string | null | undefined): string | null {
  const s = symbol?.trim() ?? '';
  return s === '' || s === '-' ? null : s;
}

export class DefiLlamaHoldersRevenueSource {
  readonly name = 'defillama-holders-revenue';

  constructor(private readonly opts: { logger: Logger; baseUrl?: string }) {}

  private get base(): string {
    return this.opts.baseUrl ?? API;
  }

  async fetchHoldersRevenue(): Promise<HoldersRevenueRow[]> {
    const raw = await fetchJsonValidated({
      url: `${this.base}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyHoldersRevenue`,
      schema: z.object({ protocols: z.array(z.unknown()) }),
      source: this.name,
      logger: this.opts.logger,
      timeoutMs: 60_000,
    });
    return parseHoldersRevenue(raw.protocols);
  }

  /** Fetched one list at a time so the peak stays small on a 512 MB host. */
  async fetchTokenDirectory(): Promise<TokenDirectory> {
    const lite = await fetchJsonValidated({
      url: `${this.base}/lite/protocols2?b=2`,
      schema: z.object({ protocols: z.array(z.unknown()), parentProtocols: z.array(z.unknown()) }),
      source: this.name,
      logger: this.opts.logger,
      timeoutMs: 60_000,
    });
    const protocols = new Map<string, TokenRef>();
    for (const row of lite.protocols) {
      const p = liteProtocolSchema.safeParse(row);
      if (!p.success || !p.data.defillamaId) continue;
      protocols.set(p.data.defillamaId, { name: p.data.name, symbol: cleanSymbol(p.data.symbol), geckoId: p.data.geckoId ?? null, mcapUsd: p.data.mcap ?? null });
    }
    const parents = new Map<string, TokenRef>();
    for (const row of lite.parentProtocols) {
      const p = parentSchema.safeParse(row);
      if (!p.success) continue;
      parents.set(p.data.id, { name: p.data.name, symbol: cleanSymbol(p.data.symbol), geckoId: p.data.gecko_id ?? null, mcapUsd: p.data.mcap ?? null });
    }

    const chainRaw = await fetchJsonValidated({
      url: `${this.base}/v2/chains`,
      schema: z.array(z.unknown()),
      source: this.name,
      logger: this.opts.logger,
      timeoutMs: 30_000,
    });
    const chains = new Map<string, TokenRef>();
    for (const row of chainRaw) {
      const c = chainSchema.safeParse(row);
      if (!c.success) continue;
      chains.set(c.data.name, { name: c.data.name, symbol: cleanSymbol(c.data.tokenSymbol), geckoId: c.data.gecko_id ?? null, mcapUsd: null });
    }
    return { protocols, parents, chains };
  }
}

export function parseHoldersRevenue(raw: unknown[]): HoldersRevenueRow[] {
  const out: HoldersRevenueRow[] = [];
  for (const row of raw) {
    const parsed = feeRowSchema.safeParse(row);
    if (!parsed.success) continue;
    const r = parsed.data;
    const mechanism = r.methodology?.['HoldersRevenue'];
    out.push({
      name: r.displayName || r.name,
      defillamaId: r.defillamaId ?? null,
      slug: r.slug ?? null,
      category: r.category ?? null,
      isChain: r.protocolType === 'chain' || (r.defillamaId ?? '').startsWith('chain#'),
      parentProtocol: r.parentProtocol ?? null,
      total30d: r.total30d ?? null,
      total60dto30d: r.total60dto30d ?? null,
      mechanism: typeof mechanism === 'string' ? mechanism.slice(0, 300) : null,
    });
  }
  return out;
}
