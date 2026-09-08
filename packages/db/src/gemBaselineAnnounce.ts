import type { Pool } from 'pg';

/**
 * What the baseline push has already said, so it can avoid saying it twice.
 *
 * The state is in Postgres rather than in the worker because the worker
 * restarts on every deploy, and an alert that repeats on each boot is one
 * the reader stops seeing. This is the message where that would cost the
 * most.
 */
export interface BaselineAnnouncement {
  horizon: string;
  verdict: string;
  scannerSampleCount: number;
  baselineSampleCount: number;
  deltaPp: number;
  marginPp: number | null;
  announcedAt: number;
}

export async function getLastBaselineAnnouncement(pool: Pool, horizon: string): Promise<BaselineAnnouncement | undefined> {
  const { rows } = await pool.query(
    `SELECT horizon, verdict, scanner_sample_count, baseline_sample_count, delta_pp, margin_pp,
            extract(epoch from announced_at)*1000 AS announced_at_ms
       FROM gem_baseline_announcements
      WHERE horizon = $1
      ORDER BY announced_at DESC
      LIMIT 1`,
    [horizon],
  );
  const r = rows[0];
  if (!r) return undefined;
  return {
    horizon: String(r.horizon),
    verdict: String(r.verdict),
    scannerSampleCount: Number(r.scanner_sample_count),
    baselineSampleCount: Number(r.baseline_sample_count),
    deltaPp: Number(r.delta_pp),
    marginPp: r.margin_pp === null ? null : Number(r.margin_pp),
    announcedAt: Number(r.announced_at_ms),
  };
}

export async function recordBaselineAnnouncement(
  pool: Pool,
  input: Omit<BaselineAnnouncement, 'announcedAt'>,
): Promise<void> {
  await pool.query(
    `INSERT INTO gem_baseline_announcements
       (horizon, verdict, scanner_sample_count, baseline_sample_count, delta_pp, margin_pp)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.horizon, input.verdict, input.scannerSampleCount, input.baselineSampleCount, input.deltaPp, input.marginPp],
  );
}
