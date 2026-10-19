import { z } from 'zod';
import { fetchJsonValidated, type Logger } from '@crypto-signal/shared';

/**
 * Gate USDT-perpetual daily open interest, one of the venues the coin
 * scan sums OI over (see `sumDailyOpenInterest`). Public, no key.
 *
 * Shapes verified against the live API (2026-10):
 * - /futures/usdt/contracts/{X_USDT}: `quanto_multiplier` = coins per
 *   contract (BTC "0.0001", PEPE "10000000").
 * - /futures/usdt/contract_stats?interval=1d: objects oldest first,
 *   `time` in seconds at UTC midnight (the forming day included),
 *   `open_interest` in contracts.
 * - A contract Gate does not list is HTTP 400 `CONTRACT_NOT_FOUND`;
 *   fetchJsonValidated throws on any non-2xx, so the caller treats a
 *   throw as "no Gate figure for this coin", which is all a missing
 *   listing means here.
 */

const BASE_URL = 'https://api.gateio.ws/api/v4';

const contractSchema = z.object({ quanto_multiplier: z.string() }).passthrough();
const statsSchema = z.array(z.object({ time: z.number(), open_interest: z.number() }).passthrough());

export interface GateOpenInterestOptions {
  logger: Logger;
  baseUrl?: string;
}

export class GateOpenInterest {
  readonly name = 'gate';
  private readonly baseUrl: string;
  /** Contract sizes do not change within a process's life in practice; one read per coin. */
  private readonly multipliers = new Map<string, number>();

  constructor(private readonly opts: GateOpenInterestOptions) {
    this.baseUrl = opts.baseUrl ?? BASE_URL;
  }

  /** Daily OI in coins of `base`, oldest first. */
  async dailyOpenInterest(base: string, points: number): Promise<Array<{ time: number; coins: number }>> {
    const contract = `${base}_USDT`;
    let multiplier = this.multipliers.get(contract);
    if (multiplier === undefined) {
      const info = await this.get(`/futures/usdt/contracts/${encodeURIComponent(contract)}`, contractSchema);
      multiplier = Number(info.quanto_multiplier);
      if (!Number.isFinite(multiplier) || multiplier <= 0) return [];
      this.multipliers.set(contract, multiplier);
    }
    const stats = await this.get(`/futures/usdt/contract_stats?contract=${encodeURIComponent(contract)}&interval=1d&limit=${points}`, statsSchema);
    return parseGateOpenInterest(stats, multiplier);
  }

  private get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    return fetchJsonValidated({ url: `${this.baseUrl}${path}`, schema, source: this.name, logger: this.opts.logger, timeoutMs: 10_000, maxRetries: 0 });
  }
}

export function parseGateOpenInterest(rows: Array<{ time: number; open_interest: number }>, multiplier: number): Array<{ time: number; coins: number }> {
  return rows
    .map((r) => ({ time: r.time * 1000, coins: r.open_interest * multiplier }))
    .filter((r) => Number.isFinite(r.time) && Number.isFinite(r.coins))
    .sort((a, b) => a.time - b.time);
}
