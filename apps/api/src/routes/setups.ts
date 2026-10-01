import type { FastifyInstance } from 'fastify';
import { getJobHealth, getRecentTradeSetups, getTradeSetupStats, JOB_SETUP_SCAN } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * Entry setups found on 4H, recent first, with how each kind has done.
 *
 * `minResolved` travels with the stats for the same reason `minClosed`
 * does on the journal: below it, a hit rate is a handful of coin flips,
 * and every client should withhold it at the same line.
 */
const MIN_RESOLVED = 20;

export function registerSetupsRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: { limit?: string } }>('/api/setups', async (req) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));
    const [setups, stats, health] = await Promise.all([
      getRecentTradeSetups(deps.pool, limit),
      getTradeSetupStats(deps.pool),
      getJobHealth(deps.pool, JOB_SETUP_SCAN),
    ]);
    return {
      setups,
      stats,
      minResolved: MIN_RESOLVED,
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
