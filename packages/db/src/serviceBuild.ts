import type { Pool } from 'pg';

/**
 * The build a long-running service is on.
 *
 * Exists because the worker has no HTTP surface: its version was knowable
 * only from a boot log, so after a deploy there was no way to tell from the
 * dashboard whether it had actually rolled over. Services here are deployed
 * separately, so that question comes up every time.
 */
export interface ServiceBuild {
  service: string;
  /** Null when no platform variable was set — not the same as "not deployed". */
  commit: string | null;
  commitSource: string | null;
  startedAt: number;
}

export const SERVICE_WORKER = 'worker';

/** Called once at boot. Overwrites the previous row: only the current build is interesting. */
export async function recordServiceBuild(
  pool: Pool,
  service: string,
  build: { commit: string | null; commitSource: string | null; startedAt: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO service_build (service, commit, commit_source, started_at, updated_at)
     VALUES ($1, $2, $3, to_timestamp($4/1000.0), now())
     ON CONFLICT (service) DO UPDATE SET
       commit = EXCLUDED.commit,
       commit_source = EXCLUDED.commit_source,
       started_at = EXCLUDED.started_at,
       updated_at = now()`,
    [service, build.commit, build.commitSource, build.startedAt],
  );
}

export async function getServiceBuilds(pool: Pool): Promise<ServiceBuild[]> {
  const { rows } = await pool.query(
    `SELECT service, commit, commit_source, extract(epoch from started_at)*1000 AS started_ms
     FROM service_build ORDER BY service`,
  );
  return rows.map((r) => ({
    service: r.service,
    commit: r.commit,
    commitSource: r.commit_source,
    startedAt: Math.round(Number(r.started_ms)),
  }));
}
