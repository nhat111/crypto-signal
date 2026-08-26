import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';

/**
 * DefiLlama stablecoin supply — the cheapest honest proxy for "new money
 * entering crypto". Total stablecoin market cap rising means fiat was
 * converted into on-chain dollars; falling means the reverse. It says
 * nothing about *which* asset that money then buys, so it is context, not
 * a signal (ASSUMPTIONS.md §17).
 *
 * Free and keyless, unlike every ETF-flow source. Daily granularity, so it
 * is deliberately kept out of the candle pipeline — nothing here feeds a
 * 5m signal.
 *
 * **The response shape below could NOT be verified from the build
 * environment** (egress-blocked, same constraint the gem-scanner adapters
 * were written under). It is validated with zod at the boundary, so a
 * wrong field name fails loudly with the real payload logged
 * (`upstream response failed schema validation`) instead of silently
 * producing a supply figure of `undefined`. If it fails on first run, the
 * log names the actual keys and this schema is a one-line fix.
 */

/**
 * `date` has been seen as both a unix-seconds string and a number across
 * DefiLlama endpoints; accepting either is not a guess about meaning, just
 * tolerance for how the same value is encoded.
 */
const dayPointSchema = z.object({
  date: z.union([z.string(), z.number()]),
  totalCirculatingUSD: z.object({ peggedUSD: z.number() }),
});

const chartResponseSchema = z.array(dayPointSchema);

const BASE_URL = 'https://stablecoins.llama.fi';

export interface StablecoinSupplyPoint {
  /** UTC calendar day, `YYYY-MM-DD`. Daily data has no meaningful time-of-day. */
  day: string;
  totalCirculatingUsd: number;
}

export interface DefiLlamaOptions {
  logger: Logger;
  baseUrl?: string;
}

export class DefiLlamaStablecoinSource {
  readonly name = 'defillama-stablecoins';
  private readonly baseUrl: string;

  constructor(private readonly opts: DefiLlamaOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  /** Full history, oldest first. The caller decides how much of it to keep. */
  async fetchSupplyHistory(): Promise<StablecoinSupplyPoint[]> {
    const raw = await fetchJsonValidated({
      url: `${this.baseUrl}/stablecoincharts/all`,
      schema: chartResponseSchema,
      source: this.name,
      logger: this.opts.logger,
      timeoutMs: 20_000,
    });

    return raw
      .map(toSupplyPoint)
      .filter((p): p is StablecoinSupplyPoint => p !== null)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
}

export function toSupplyPoint(raw: z.infer<typeof dayPointSchema>): StablecoinSupplyPoint | null {
  const seconds = typeof raw.date === 'number' ? raw.date : Number(raw.date);
  // A row whose date won't parse is dropped rather than dated to the epoch —
  // a wrong day would silently corrupt every change-over-N-days figure.
  if (!Number.isFinite(seconds)) return null;

  const day = new Date(seconds * 1000).toISOString().slice(0, 10);
  return { day, totalCirculatingUsd: raw.totalCirculatingUSD.peggedUSD };
}

/** Exported for tests — lets the normalization be exercised without a network call. */
export const __testing = { dayPointSchema, chartResponseSchema };
