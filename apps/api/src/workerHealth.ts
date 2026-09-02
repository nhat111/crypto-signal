import { HEARTBEAT_STALE_MS, type WorkerRuntime } from '@crypto-signal/db';

/**
 * How the worker's heartbeat is reported on /health.
 *
 * Extracted from the route because it is the part that can be quietly
 * wrong, and being wrong here is expensive in both directions: a rule that
 * never fires makes the probe decorative, and one that fires on a healthy
 * system trains whoever watches it to ignore red.
 */
export type WorkerHealthStatus = 'ok' | 'degraded' | 'stale' | 'no_heartbeat_yet';

export interface WorkerHealthCheck {
  status: WorkerHealthStatus;
  ageMs?: number;
  /**
   * Last reported socket states. When `status` is `stale` these describe a
   * process that may no longer exist — the row simply stopped being
   * updated, so they are the last thing it said, not what is true now.
   */
  connections?: WorkerRuntime['connections'];
  /** Whether this check should turn the endpoint red. */
  healthy: boolean;
}

export function evaluateWorkerHealth(
  runtime: WorkerRuntime | null,
  staleMs: number = HEARTBEAT_STALE_MS,
): WorkerHealthCheck {
  // Never having reported is a cold start, not a fault. Collector freshness
  // already covers "this system has produced no data", and reddening here
  // too would make a first deploy look broken.
  if (runtime === null) return { status: 'no_heartbeat_yet', healthy: true };

  if (runtime.ageMs > staleMs) {
    return { status: 'stale', ageMs: runtime.ageMs, connections: runtime.connections, healthy: false };
  }

  // A socket that is not open is a real problem, but a different one: the
  // process is alive and saying so. Turning the endpoint red for it would
  // conflate "the collector is gone" with "one of its three feeds is
  // reconnecting", and only the first is worth waking someone for.
  const allOpen = Object.values(runtime.connections).every((state) => state === 'open');
  return {
    status: allOpen ? 'ok' : 'degraded',
    ageMs: runtime.ageMs,
    connections: runtime.connections,
    healthy: true,
  };
}
