import type { FastifyInstance } from 'fastify';
import { COIN_EDGE_HORIZONS, COIN_EDGE_MIN_SAMPLES, getCoinScanEdge, getJobHealth, getLatestCoinScan, JOB_COIN_SCAN } from '@crypto-signal/db';
import { pickWatchlist } from '@crypto-signal/indicators';
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
      // The coins whose 4H setups are alerted, by the same rule the worker
      // applies to this same scan. Empty when coin setups are off.
      watchlist: deps.config.coinScan.setups
        ? pickWatchlist(scan.rows, deps.config.coinScan.watchlistSize, [...deps.config.symbols, ...deps.config.futuresOnlySymbols]).map((r) => r.symbol)
        : [],
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

  /**
   * Whether the scan's groups went on to beat BTC: the top fifth by RS
   * against the bottom fifth, and each flow label against all coins, per
   * exchange. `verdict` stays null below `minSamples`.
   */
  app.get<{ Querystring: { horizon?: string } }>('/api/coins/edge', async (req, reply) => {
    const horizon = Number(req.query.horizon ?? 7);
    if (!(COIN_EDGE_HORIZONS as readonly number[]).includes(horizon)) {
      return reply.code(400).send({ error: `horizon must be one of ${COIN_EDGE_HORIZONS.join(', ')}` });
    }
    return { horizonDays: horizon, minSamples: COIN_EDGE_MIN_SAMPLES, reports: await getCoinScanEdge(deps.pool, horizon) };
  });
}
