import type { FastifyInstance } from 'fastify';
import { getJobHealth, getRecentStablecoinSupply, JOB_STABLECOIN_FLOW } from '@crypto-signal/db';
import { computeStablecoinFlow } from '@crypto-signal/indicators';
import type { ApiDeps } from '../deps.js';

/**
 * Macro flow context. Computed on read from the stored daily series — the
 * same pattern as the Bollinger reference range, and for the same reason:
 * nothing scores or alerts on it, so there's no need to thread it through
 * the write pipeline.
 *
 * 45 days covers the 30d window with room for gaps in the upstream series.
 */
const HISTORY_DAYS = 45;

export function registerFlowRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/flow', async () => {
    const [points, health] = await Promise.all([
      getRecentStablecoinSupply(deps.pool, HISTORY_DAYS),
      getJobHealth(deps.pool, JOB_STABLECOIN_FLOW),
    ]);

    // `stablecoin` alone cannot say why it is null — not refreshed yet, or
    // refreshing and failing every time. `fetch` is what separates those,
    // and it is also how a stale-but-present reading becomes visible: data
    // can exist while every refresh since has been throwing.
    return {
      stablecoin: computeStablecoinFlow(points),
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
