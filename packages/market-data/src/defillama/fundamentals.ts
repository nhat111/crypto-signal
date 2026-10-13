import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';

/**
 * DefiLlama reads for the coin scan's fundamentals: chains, protocols,
 * fees, and per-chain TVL and stablecoin history. Free and keyless.
 *
 * Shapes verified against the live API (2026-10). The protocol list is
 * ~9 MB and 8,700 rows, so rows are validated one by one and a row that
 * does not fit is dropped: one malformed protocol must not cost every
 * coin its fundamentals. Only the handful of fields read are kept, which
 * is also what keeps the parsed list small on a 512 MB host.
 */

const API = 'https://api.llama.fi';
const STABLES = 'https://stablecoins.llama.fi';

const chainSchema = z.object({ name: z.string(), tokenSymbol: z.string().nullable().optional(), tvl: z.number() });
const protocolSchema = z.object({
  name: z.string(),
  symbol: z.string().nullable().optional(),
  parentProtocol: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  tvl: z.number().nullable().optional(),
  change_7d: z.number().nullable().optional(),
});
const feeSchema = z.object({
  name: z.string(),
  category: z.string().nullable().optional(),
  parentProtocol: z.string().nullable().optional(),
  total30d: z.number().nullable().optional(),
  total60dto30d: z.number().nullable().optional(),
});
const tvlPointSchema = z.object({ date: z.number(), tvl: z.number() });
const stablePointSchema = z.object({
  date: z.union([z.string(), z.number()]),
  totalCirculatingUSD: z.object({ peggedUSD: z.number().optional() }).passthrough(),
});

const listSchema = z.array(z.unknown());
const feesEnvelope = z.object({ protocols: z.array(z.unknown()) });

export type DefiLlamaChain = { name: string; tokenSymbol: string | null; tvl: number };
export type DefiLlamaProtocol = {
  name: string;
  symbol: string | null;
  parentProtocol: string | null;
  category: string | null;
  tvl: number | null;
  change7d: number | null;
};
export type DefiLlamaFees = { name: string; category: string | null; parentProtocol: string | null; total30d: number | null; total60dto30d: number | null };
export type DefiLlamaDayValue = { date: number; value: number };

/** Every row that fits the schema, mapped; the rest dropped. */
function rows<S extends z.ZodTypeAny, T>(items: unknown[], schema: S, map: (row: z.output<S>) => T): T[] {
  const out: T[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(map(parsed.data));
  }
  return out;
}

export interface DefiLlamaFundamentalsOptions {
  logger: Logger;
  apiBase?: string;
  stablesBase?: string;
}

export class DefiLlamaFundamentalsSource {
  readonly name = 'defillama-fundamentals';
  private readonly api: string;
  private readonly stables: string;

  constructor(private readonly opts: DefiLlamaFundamentalsOptions) {
    this.api = opts.apiBase ?? API;
    this.stables = opts.stablesBase ?? STABLES;
  }

  private get<S extends z.ZodTypeAny>(url: string, schema: S): Promise<z.output<S>> {
    return fetchJsonValidated({ url, schema, source: this.name, logger: this.opts.logger, timeoutMs: 30_000, maxRetries: 1 });
  }

  async chains(): Promise<DefiLlamaChain[]> {
    return rows(await this.get(`${this.api}/v2/chains`, listSchema), chainSchema, (c) => ({ name: c.name, tokenSymbol: c.tokenSymbol ?? null, tvl: c.tvl }));
  }

  async protocols(): Promise<DefiLlamaProtocol[]> {
    return rows(await this.get(`${this.api}/protocols`, listSchema), protocolSchema, (p) => ({
      name: p.name,
      symbol: p.symbol && p.symbol !== '-' ? p.symbol : null,
      parentProtocol: p.parentProtocol ?? null,
      category: p.category ?? null,
      tvl: p.tvl ?? null,
      change7d: p.change_7d ?? null,
    }));
  }

  async fees(): Promise<DefiLlamaFees[]> {
    const res = await this.get(`${this.api}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`, feesEnvelope);
    return rows(res.protocols, feeSchema, (f) => ({
      name: f.name,
      category: f.category ?? null,
      parentProtocol: f.parentProtocol ?? null,
      total30d: f.total30d ?? null,
      total60dto30d: f.total60dto30d ?? null,
    }));
  }

  /** Daily TVL of one chain, by DefiLlama's chain name. */
  async chainTvl(chain: string): Promise<DefiLlamaDayValue[]> {
    const raw = await this.get(`${this.api}/v2/historicalChainTvl/${encodeURIComponent(chain)}`, listSchema);
    return rows(raw, tvlPointSchema, (p) => ({ date: p.date, value: p.tvl }));
  }

  /** Daily USD-pegged stablecoin supply on one chain. */
  async chainStablecoins(chain: string): Promise<DefiLlamaDayValue[]> {
    const raw = await this.get(`${this.stables}/stablecoincharts/${encodeURIComponent(chain)}`, listSchema);
    return rows(raw, stablePointSchema, (p) => ({ date: Number(p.date), value: p.totalCirculatingUSD.peggedUSD ?? 0 })).filter(
      (p) => Number.isFinite(p.date) && p.value > 0,
    );
  }
}
