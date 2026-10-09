import type { FastifyInstance } from 'fastify';
import { getJobHealth, getTrendStates, JOB_TREND_1D } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * The daily market-structure read the worker stores, one row per symbol.
 *
 * `fetch` travels with it for the same reason as /api/flow: an empty or
 * old list cannot say on its own whether the job has not run yet or has
 * been failing — and a trend label a day stale looks exactly like a fresh
 * one.
 */
export function registerTrendRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/trend', async () => {
    const [trends, health] = await Promise.all([getTrendStates(deps.pool), getJobHealth(deps.pool, JOB_TREND_1D)]);
    return {
      trends,
      fetch: health
        ? {
            lastAttemptAt: health.lastAttemptAt,
            lastSuccessAt: health.lastSuccessAt,
            consecutiveFailures: health.consecutiveFailures,
            lastError: health.lastError,
          }
        : null,
    };
  });
}
