import type { FastifyInstance } from 'fastify';
import {
  getJobHealth,
  getLatestSpotBreakoutRun,
  getOpenSpotBreakouts,
  getRecentClosedSpotBreakouts,
  getSpotBreakoutStats,
  JOB_SPOT_BREAKOUTS,
} from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * The daily spot breakout list (ASSUMPTIONS §27): open positions with
 * their stop and trailing line, recent exits, and the live record.
 *
 * `minClosed` travels with the stats for the same reason `minResolved`
 * does on /api/setups: below it the average is a handful of trades, and
 * every client withholds a verdict at the same line. `replay` is the
 * number the live record is to be compared with, sent from here so the
 * web and the bot cannot quote different ones.
 */
const MIN_CLOSED = 30;
const REPLAY = { trades: 175, winPct: 36, avgR: 0.17, from: '2024-08-27', to: '2026-10-23', coins: 41 };

export function registerBreakoutsRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: { limit?: string } }>('/api/breakouts', async (req) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
    const [open, closed, stats, run, health] = await Promise.all([
      getOpenSpotBreakouts(deps.pool),
      getRecentClosedSpotBreakouts(deps.pool, limit),
      getSpotBreakoutStats(deps.pool),
      getLatestSpotBreakoutRun(deps.pool),
      getJobHealth(deps.pool, JOB_SPOT_BREAKOUTS),
    ]);
    return {
      enabled: deps.config.spotBreakouts.enabled,
      run,
      open,
      closed,
      stats,
      minClosed: MIN_CLOSED,
      replay: REPLAY,
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
