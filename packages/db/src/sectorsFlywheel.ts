import type { Pool } from 'pg';
import type { FlywheelRow, SectorLabel, SectorRead } from '@crypto-signal/indicators';

/** Both lists keep this many days, for comparing a label or a payout with its past. */
export const SECTOR_FLYWHEEL_RETENTION_DAYS = 120;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface SectorRow extends SectorRead {
  day: string;
  /** The label on the previous stored day, so a change can be pointed out. */
  previousLabel: SectorLabel | null;
}

/** One category for one day; a rerun overwrites it. */
export async function upsertSectorRead(pool: Pool, day: string, r: SectorRead): Promise<void> {
  await pool.query(
    `INSERT INTO sector_days
       (day, category_id, name, coin_count, median_7d_pct, median_30d_pct, rs_7d, rs_30d,
        breadth_7d_pct, breadth_30d_pct, weighted_7d_pct, btc_7d_pct, btc_30d_pct, label, leaders, reasons)
     VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb)
     ON CONFLICT (day, category_id) DO UPDATE SET
       name = EXCLUDED.name, coin_count = EXCLUDED.coin_count,
       median_7d_pct = EXCLUDED.median_7d_pct, median_30d_pct = EXCLUDED.median_30d_pct,
       rs_7d = EXCLUDED.rs_7d, rs_30d = EXCLUDED.rs_30d,
       breadth_7d_pct = EXCLUDED.breadth_7d_pct, breadth_30d_pct = EXCLUDED.breadth_30d_pct,
       weighted_7d_pct = EXCLUDED.weighted_7d_pct, btc_7d_pct = EXCLUDED.btc_7d_pct, btc_30d_pct = EXCLUDED.btc_30d_pct,
       label = EXCLUDED.label, leaders = EXCLUDED.leaders, reasons = EXCLUDED.reasons, computed_at = now()`,
    [
      day, r.categoryId, r.name, r.coinCount, r.median7dPct, r.median30dPct, r.rs7d, r.rs30d,
      r.breadth7dPct, r.breadth30dPct, r.weighted7dPct, r.btc7dPct, r.btc30dPct, r.label,
      JSON.stringify(r.leaders), JSON.stringify(r.reasons),
    ],
  );
}

/** Categories already stored for the day, so a rerun only fetches what is missing. */
export async function getStoredSectorIds(pool: Pool, day: string): Promise<Set<string>> {
  const { rows } = await pool.query('SELECT category_id FROM sector_days WHERE day = $1::date', [day]);
  return new Set(rows.map((r) => r.category_id as string));
}

export async function pruneSectorFlywheel(pool: Pool, day: string): Promise<void> {
  await pool.query('DELETE FROM sector_days WHERE day < $1::date - $2::int', [day, SECTOR_FLYWHEEL_RETENTION_DAYS]);
  await pool.query('DELETE FROM flywheel_days WHERE day < $1::date - $2::int', [day, SECTOR_FLYWHEEL_RETENTION_DAYS]);
}

/** The latest stored day, strongest 7-day relative strength first. */
export async function getLatestSectors(pool: Pool): Promise<{ day: string | null; sectors: SectorRow[] }> {
  const { rows } = await pool.query(
    `WITH latest AS (SELECT max(day) AS day FROM sector_days),
          prev AS (SELECT max(day) AS day FROM sector_days WHERE day < (SELECT day FROM latest))
     SELECT to_char(s.day, 'YYYY-MM-DD') AS day_text, s.*, p.label AS previous_label
     FROM sector_days s
     LEFT JOIN sector_days p ON p.category_id = s.category_id AND p.day = (SELECT day FROM prev)
     WHERE s.day = (SELECT day FROM latest)
     ORDER BY s.rs_7d DESC`,
  );
  return {
    day: rows.length > 0 ? (rows[0].day_text as string) : null,
    sectors: rows.map((r) => ({
      day: r.day_text as string,
      categoryId: r.category_id as string,
      name: r.name as string,
      coinCount: Number(r.coin_count),
      median7dPct: Number(r.median_7d_pct),
      median30dPct: Number(r.median_30d_pct),
      rs7d: Number(r.rs_7d),
      rs30d: Number(r.rs_30d),
      breadth7dPct: Number(r.breadth_7d_pct),
      breadth30dPct: Number(r.breadth_30d_pct),
      weighted7dPct: num(r.weighted_7d_pct),
      btc7dPct: Number(r.btc_7d_pct),
      btc30dPct: Number(r.btc_30d_pct),
      label: r.label as SectorLabel,
      leaders: (r.leaders as SectorRow['leaders']) ?? [],
      reasons: (r.reasons as string[]) ?? [],
      previousLabel: (r.previous_label as SectorLabel | null) ?? null,
    })),
  };
}

export interface FlywheelStoredRow extends FlywheelRow {
  day: string;
}

/** Replaces the day, so a rerun drops a family that no longer qualifies. */
export async function replaceFlywheelDay(pool: Pool, day: string, rows: FlywheelRow[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM flywheel_days WHERE day = $1::date', [day]);
    for (const r of rows) {
      await client.query(
        `INSERT INTO flywheel_days
           (day, family_key, name, symbol, gecko_id, category, holders_revenue_30d_usd, holders_revenue_prev_30d_usd,
            holders_revenue_change_pct, annualized_usd, market_cap_usd, yield_pct, price_change_30d_pct, mechanism,
            sources, reasons, unknowns)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb)`,
        [
          day, r.familyKey, r.name, r.symbol, r.geckoId, r.category, r.holdersRevenue30dUsd, r.holdersRevenuePrev30dUsd,
          r.holdersRevenueChangePct, r.annualizedUsd, r.marketCapUsd, r.yieldPct, r.priceChange30dPct, r.mechanism,
          JSON.stringify(r.sources), JSON.stringify(r.reasons), JSON.stringify(r.unknowns),
        ],
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function hasFlywheelDay(pool: Pool, day: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM flywheel_days WHERE day = $1::date LIMIT 1', [day]);
  return rows.length > 0;
}

/** The latest stored day, largest 30-day payout first. */
export async function getLatestFlywheel(pool: Pool, limit = 100): Promise<{ day: string | null; rows: FlywheelStoredRow[] }> {
  const { rows } = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day_text, *
     FROM flywheel_days
     WHERE day = (SELECT max(day) FROM flywheel_days)
     ORDER BY holders_revenue_30d_usd DESC
     LIMIT $1`,
    [limit],
  );
  return {
    day: rows.length > 0 ? (rows[0].day_text as string) : null,
    rows: rows.map((r) => ({
      day: r.day_text as string,
      familyKey: r.family_key as string,
      name: r.name as string,
      symbol: (r.symbol as string | null) ?? null,
      geckoId: (r.gecko_id as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      holdersRevenue30dUsd: Number(r.holders_revenue_30d_usd),
      holdersRevenuePrev30dUsd: num(r.holders_revenue_prev_30d_usd),
      holdersRevenueChangePct: num(r.holders_revenue_change_pct),
      annualizedUsd: Number(r.annualized_usd),
      marketCapUsd: num(r.market_cap_usd),
      yieldPct: num(r.yield_pct),
      priceChange30dPct: num(r.price_change_30d_pct),
      mechanism: (r.mechanism as string | null) ?? null,
      sources: (r.sources as string[]) ?? [],
      reasons: (r.reasons as string[]) ?? [],
      unknowns: (r.unknowns as string[]) ?? [],
    })),
  };
}
