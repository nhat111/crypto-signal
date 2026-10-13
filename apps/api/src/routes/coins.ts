import type { FastifyInstance } from 'fastify';
import { getJobHealth, getLatestCoinScan, JOB_COIN_SCAN } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * The wide coin scan: the latest day's read of the most-traded coins.
 *
 * `enabled` and `fetch` travel with the rows because an empty list has
 * three different causes — switched off, not run yet, failing — and the
 * page has to say which one it is.
 */
export function registerCoinsRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/coins', async () => {
    const [scan, health] = await Promise.all([getLatestCoinScan(deps.pool), getJobHealth(deps.pool, JOB_COIN_SCAN)]);
    return {
      enabled: deps.config.coinScan.enabled,
      day: scan.day,
      // One day is read from one exchange; null before the first scan.
      exchange: scan.rows[0]?.exchange ?? null,
      rows: scan.rows,
      thresholds: deps.config.coinScan.thresholds,
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
