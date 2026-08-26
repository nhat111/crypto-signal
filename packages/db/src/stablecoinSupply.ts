import type { Pool } from 'pg';

export interface StablecoinSupplyRow {
  day: string;
  totalCirculatingUsd: number;
}

/**
 * Upserts a batch of daily points. The upstream series is a full history on
 * every fetch, so re-inserting known days is the normal case, not an error
 * — the latest fetch wins, since DefiLlama restates recent days as more
 * chains report in.
 */
export async function upsertStablecoinSupply(pool: Pool, points: StablecoinSupplyRow[]): Promise<number> {
  if (points.length === 0) return 0;

  // One statement rather than a loop: the first fetch carries years of
  // history, and a round trip per day would take minutes.
  const values: unknown[] = [];
  const tuples = points.map((p, i) => {
    values.push(p.day, p.totalCirculatingUsd);
    return `($${i * 2 + 1}::date, $${i * 2 + 2}::double precision)`;
  });

  const { rowCount } = await pool.query(
    `INSERT INTO stablecoin_supply (day, total_circulating_usd)
     VALUES ${tuples.join(',')}
     ON CONFLICT (day) DO UPDATE SET
       total_circulating_usd = EXCLUDED.total_circulating_usd,
       fetched_at = now()`,
    values,
  );
  return rowCount ?? 0;
}

/** Most recent `days` of history, returned oldest→newest as computeStablecoinFlow expects. */
export async function getRecentStablecoinSupply(pool: Pool, days = 45): Promise<StablecoinSupplyRow[]> {
  const { rows } = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, total_circulating_usd
     FROM stablecoin_supply
     ORDER BY day DESC
     LIMIT $1`,
    [days],
  );
  return rows
    .map((r) => ({ day: r.day as string, totalCirculatingUsd: Number(r.total_circulating_usd) }))
    .reverse();
}
