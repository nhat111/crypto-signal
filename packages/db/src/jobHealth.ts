import type { Pool } from 'pg';

/**
 * Whether a background job is actually working.
 *
 * A job that quietly fails forever is indistinguishable, on every surface
 * that reads its output, from one that has not run yet — both show an
 * empty result. Recording the outcome of each run is what separates them.
 */
export interface JobHealth {
  jobName: string;
  lastAttemptAt: number | null;
  /** Null means it has never succeeded once — a far worse state than "succeeded a while ago". */
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

/** Long enough to identify the failure, short enough that a stack trace cannot fill the column. */
const MAX_ERROR_CHARS = 500;

export async function recordJobSuccess(pool: Pool, jobName: string): Promise<void> {
  await pool.query(
    `INSERT INTO job_health (job_name, last_attempt_at, last_success_at, consecutive_failures, last_error)
     VALUES ($1, now(), now(), 0, NULL)
     ON CONFLICT (job_name) DO UPDATE SET
       last_attempt_at = now(), last_success_at = now(),
       consecutive_failures = 0, last_error = NULL`,
    [jobName],
  );
}

export async function recordJobFailure(pool: Pool, jobName: string, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_CHARS);
  await pool.query(
    `INSERT INTO job_health (job_name, last_attempt_at, last_success_at, consecutive_failures, last_error)
     VALUES ($1, now(), NULL, 1, $2)
     ON CONFLICT (job_name) DO UPDATE SET
       last_attempt_at = now(),
       -- last_success_at is deliberately left alone: a failure now does not
       -- unmake the last success, and how long ago that was is the number
       -- worth seeing.
       consecutive_failures = job_health.consecutive_failures + 1,
       last_error = EXCLUDED.last_error`,
    [jobName, message],
  );
}

/** Undefined when the job has never been recorded at all — i.e. it has genuinely never run. */
export async function getJobHealth(pool: Pool, jobName: string): Promise<JobHealth | undefined> {
  const { rows } = await pool.query(
    `SELECT job_name,
            extract(epoch from last_attempt_at)*1000 AS attempt_ms,
            extract(epoch from last_success_at)*1000 AS success_ms,
            consecutive_failures, last_error
     FROM job_health WHERE job_name = $1`,
    [jobName],
  );
  const r = rows[0];
  if (!r) return undefined;
  return {
    jobName: r.job_name,
    // extract(epoch from ...) is a float, so the raw value carries a
    // fractional millisecond — meaningless here and awkward in JSON.
    lastAttemptAt: r.attempt_ms === null ? null : Math.round(Number(r.attempt_ms)),
    lastSuccessAt: r.success_ms === null ? null : Math.round(Number(r.success_ms)),
    consecutiveFailures: Number(r.consecutive_failures),
    lastError: r.last_error,
  };
}

/** Job names are referenced from both the writer and the reader, so they live in one place. */
export const JOB_STABLECOIN_FLOW = 'stablecoin_flow';
