import type { StatusCollectorSymbol, StatusJob, StatusOutcomeHorizon, StatusVersion } from './types';

/**
 * The verdict rules for the status page, kept out of the JSX.
 *
 * These are the part that can be quietly wrong — a rule that never fires
 * makes the page a decoration, and one that fires on healthy data trains
 * the reader to ignore it. Pure functions so they can be tested against
 * the states they exist to catch.
 */
export type Verdict = 'ok' | 'warn' | 'bad' | 'idle';

/** A snapshot older than this means the collector is not keeping up — matches /health. */
export const STALE_SNAPSHOT_MS = 15 * 60_000;

/** One failure after a good run is an upstream hiccup; a streak is a bug. */
export const FAILURE_STREAK_WORTH_SHOWING = 3;

/**
 * A missing commit variable is a gap in what can be reported, not a fault
 * in the service, so it reads as neutral rather than red.
 */
export function versionVerdict(version: StatusVersion): Verdict {
  return version.commit === null ? 'idle' : 'ok';
}

export function collectorVerdict(rows: StatusCollectorSymbol[]): Verdict {
  if (rows.length === 0) return 'idle';
  const bad = rows.some((r) => r.lastSnapshotAt === null || (r.ageMs ?? 0) > STALE_SNAPSHOT_MS);
  return bad ? 'bad' : 'ok';
}

export function symbolVerdict(row: StatusCollectorSymbol): Verdict {
  if (row.lastSnapshotAt === null) return 'bad';
  return (row.ageMs ?? 0) > STALE_SNAPSHOT_MS ? 'bad' : 'ok';
}

/**
 * Work waiting is normal; work that cannot be done is not. A backlog being
 * chewed through and one that can never be priced both read as "lots
 * pending", and only the resolvable count tells them apart.
 */
export function isHorizonStuck(o: StatusOutcomeHorizon): boolean {
  return o.pending > 0 && o.resolvableNow === 0;
}

export function outcomesVerdict(outcomes: StatusOutcomeHorizon[]): Verdict {
  if (outcomes.some(isHorizonStuck)) return 'warn';
  return outcomes.some((o) => o.pending > 0) ? 'ok' : 'idle';
}

/** Never once succeeded. Not a slow start — this needs fixing. */
export function isJobBroken(job: StatusJob): boolean {
  return job.lastSuccessAt === null && job.consecutiveFailures > 0;
}

/** Worked before, failing now: the output looks live and is going stale. */
export function isJobFailing(job: StatusJob): boolean {
  return !isJobBroken(job) && job.consecutiveFailures >= FAILURE_STREAK_WORTH_SHOWING;
}

export function jobsVerdict(jobs: StatusJob[]): Verdict {
  if (jobs.some(isJobBroken)) return 'bad';
  if (jobs.some(isJobFailing)) return 'warn';
  return jobs.length === 0 ? 'idle' : 'ok';
}
