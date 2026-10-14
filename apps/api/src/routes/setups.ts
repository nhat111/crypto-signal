import type { FastifyInstance } from 'fastify';
import {
  compareSetupCohorts,
  getJobHealth,
  getRecentTradeSetups,
  getTradeSetupStats,
  JOB_COIN_SETUP_SCAN,
  JOB_SETUP_SCAN,
  SETUP_COHORTS,
  type SetupCohort,
} from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * Entry setups found on 4H, recent first, with how each kind has done.
 *
 * `minResolved` travels with the stats for the same reason `minClosed`
 * does on the journal: below it, a hit rate is a handful of coin flips,
 * and every client should withhold it at the same line.
 */
const MIN_RESOLVED = 20;
/** The setups anyone is told about. The baseline cohort is there for the comparison, and only listed when asked for. */
const DEFAULT_COHORTS: SetupCohort[] = ['core', 'watchlist'];

function parseCohorts(raw: string | undefined): SetupCohort[] | null {
  if (raw === undefined || raw === '') return DEFAULT_COHORTS;
  if (raw === 'all') return [...SETUP_COHORTS];
  const picked = raw.split(',').map((c) => c.trim());
  return picked.every((c): c is SetupCohort => (SETUP_COHORTS as readonly string[]).includes(c)) ? picked : null;
}

export function registerSetupsRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: { limit?: string; cohort?: string } }>('/api/setups', async (req, reply) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));
    const cohorts = parseCohorts(req.query.cohort);
    if (!cohorts) return reply.code(400).send({ error: `cohort must be "all" or a comma list of ${SETUP_COHORTS.join(', ')}` });
    const [setups, stats, health, coinHealth] = await Promise.all([
      getRecentTradeSetups(deps.pool, limit, cohorts),
      getTradeSetupStats(deps.pool),
      getJobHealth(deps.pool, JOB_SETUP_SCAN),
      getJobHealth(deps.pool, JOB_COIN_SETUP_SCAN),
    ]);
    return {
      setups,
      stats,
      cohortComparison: compareSetupCohorts(stats, MIN_RESOLVED),
      minResolved: MIN_RESOLVED,
      coinFetch: coinHealth
        ? {
            lastAttemptAt: coinHealth.lastAttemptAt,
            lastSuccessAt: coinHealth.lastSuccessAt,
            consecutiveFailures: coinHealth.consecutiveFailures,
            lastError: coinHealth.lastError,
          }
        : null,
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
