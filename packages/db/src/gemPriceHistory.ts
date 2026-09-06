import type { Pool } from 'pg';

/**
 * The observation log behind every "what happened to it afterwards"
 * question.
 *
 * The scanner's own tables record tokens at the moment they qualified.
 * This one records them on every scan from then on, whether they still
 * qualify or not — see migration 022 for why that gap mattered. Nothing
 * here interprets the data; it exists so that an analysis written months
 * from now has something to run against, because price history is the one
 * thing that cannot be backfilled after the fact.
 */
export interface GemPriceObservation {
  chainId: string;
  tokenAddress: string;
  observedAt: number;
  priceUsd: number;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  eligible: boolean;
}

/**
 * Writes observations, skipping any the scan already recorded.
 *
 * Returns how many rows were actually new, so a caller that expects to be
 * observing tokens can tell "nothing changed" from "nothing ran".
 */
export async function insertGemPriceObservations(pool: Pool, rows: GemPriceObservation[]): Promise<number> {
  if (rows.length === 0) return 0;

  const values: string[] = [];
  const params: unknown[] = [];
  for (const row of rows) {
    const i = params.length;
    values.push(`($${i + 1}, $${i + 2}, to_timestamp($${i + 3}/1000.0), $${i + 4}, $${i + 5}, $${i + 6}, $${i + 7})`);
    params.push(row.chainId, row.tokenAddress, row.observedAt, row.priceUsd, row.liquidityUsd, row.volume24hUsd, row.eligible);
  }

  const { rowCount } = await pool.query(
    `INSERT INTO gem_price_observations
       (chain_id, token_address, observed_at, price_usd, liquidity_usd, volume_24h_usd, eligible)
     VALUES ${values.join(', ')}
     ON CONFLICT (chain_id, token_address, observed_at) DO NOTHING`,
    params,
  );
  return rowCount ?? 0;
}

/**
 * Which tokens on this chain are worth re-pricing even though the scanner
 * would not surface them today.
 *
 * Only tokens that were eligible at least once: those are the ones the
 * scanner made a claim about, and the ones whose later fate says whether
 * the claim was worth anything. A token that never qualified has a control
 * row in the baseline instead.
 *
 * Bounded by count and by age, because this costs an API call per 30
 * addresses on every scan, forever — an unbounded watchlist would quietly
 * grow until the scan cycle stopped finishing.
 */
export async function getTrackedGemTokens(
  pool: Pool,
  chainId: string,
  opts: { limit: number; maxAgeDays: number },
): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT t.token_address
     FROM gem_tokens t
     WHERE t.chain_id = $1
       AND t.first_seen_at >= now() - ($2 || ' days')::interval
       AND EXISTS (
         SELECT 1 FROM gem_scans s
         WHERE s.chain_id = t.chain_id AND s.token_address = t.token_address
       )
     ORDER BY t.last_seen_at DESC
     LIMIT $3`,
    [chainId, opts.maxAgeDays, opts.limit],
  );
  return rows.map((r) => String(r.token_address));
}

/** Every observation of one token, oldest first — the shape an analysis reads. */
export async function getGemPriceHistory(
  pool: Pool,
  chainId: string,
  tokenAddress: string,
  sinceMs?: number,
): Promise<GemPriceObservation[]> {
  const params: unknown[] = [chainId, tokenAddress];
  let sinceFilter = '';
  if (sinceMs !== undefined) {
    params.push(sinceMs);
    sinceFilter = `AND observed_at >= to_timestamp($${params.length}/1000.0)`;
  }

  const { rows } = await pool.query(
    `SELECT chain_id, token_address, extract(epoch from observed_at)*1000 AS ts,
            price_usd, liquidity_usd, volume_24h_usd, eligible
     FROM gem_price_observations
     WHERE chain_id = $1 AND token_address = $2 ${sinceFilter}
     ORDER BY observed_at ASC`,
    params,
  );
  return rows.map((r) => ({
    chainId: String(r.chain_id),
    tokenAddress: String(r.token_address),
    observedAt: Math.round(Number(r.ts)),
    priceUsd: Number(r.price_usd),
    liquidityUsd: r.liquidity_usd === null ? null : Number(r.liquidity_usd),
    volume24hUsd: r.volume_24h_usd === null ? null : Number(r.volume_24h_usd),
    eligible: Boolean(r.eligible),
  }));
}

/**
 * Drops observations older than the retention window.
 *
 * Deliberately much longer than the 30 days gem scans keep: the whole
 * point of this table is answering questions about what happened over
 * weeks and months, and pruning it on the scans' schedule would recreate
 * the hole it exists to close.
 */
export async function pruneGemPriceObservations(pool: Pool, olderThanDays: number): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM gem_price_observations WHERE observed_at < now() - ($1 || ' days')::interval`,
    [olderThanDays],
  );
  return rowCount ?? 0;
}
