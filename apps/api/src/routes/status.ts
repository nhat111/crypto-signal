import type { FastifyInstance } from 'fastify';
import {
  getAllJobHealth,
  getEnabledSymbols,
  getOutcomeTrackerStatus,
  getPricingCandleCoverage,
  getServiceBuilds,
  getStuckOutcomeCensus,
  getStuckOutcomeSample,
  getWorkerRuntime,
  type OutcomeHorizon,
} from '@crypto-signal/db';
import { resolveBuildInfo } from '@crypto-signal/shared';
import type { ApiDeps } from '../deps.js';

const BUILD = resolveBuildInfo();

/**
 * Everything needed to answer "is this thing actually working?" without a
 * terminal.
 *
 * /health already carries the build and schema version, but it is an uptime
 * probe: polled often, and deliberately cheap. The checks that matter after
 * a deploy — is the outcome tracker keeping up, has a background job been
 * failing silently — need aggregate queries that have no business running
 * on every probe. So they live here, read by one page, on demand.
 *
 * The operator is usually on a phone. A psql session and a curl pipeline
 * are not available there, which is exactly when a silent failure gets to
 * stay silent.
 */
export function registerStatusRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/status', async () => {
    const [symbols, outcomes, jobs, serviceBuilds, workerRuntime] = await Promise.all([
      getEnabledSymbols(deps.pool),
      getOutcomeTrackerStatus(deps.pool),
      getAllJobHealth(deps.pool),
      getServiceBuilds(deps.pool),
      getWorkerRuntime(deps.pool),
    ]);

    const { rows: migrations } = await deps.pool.query(
      `SELECT filename, extract(epoch from applied_at)*1000 AS applied_ms
       FROM schema_migrations ORDER BY filename DESC LIMIT 1`,
    );

    const { rows: freshness } = await deps.pool.query(
      `SELECT DISTINCT ON (symbol) symbol, extract(epoch from timestamp)*1000 AS ts
       FROM market_health_snapshots
       WHERE symbol = ANY($1) AND timeframe = ANY($2)
       ORDER BY symbol, timestamp DESC`,
      [symbols, deps.config.timeframes],
    );

    const now = Date.now();
    return {
      version: {
        commit: BUILD.commit,
        commitSource: BUILD.commitSource,
        startedAt: BUILD.startedAt,
        uptimeMs: now - BUILD.startedAt,
        schema: {
          latest: migrations[0]?.filename ?? null,
          appliedAt: migrations[0]?.applied_ms == null ? null : Math.round(Number(migrations[0].applied_ms)),
        },
      },
      // The api's own build comes from this process; every other service
      // reports itself into the database at boot, because none of them has
      // an HTTP surface to ask.
      services: serviceBuilds,
      collector: symbols.map((symbol) => {
        const row = freshness.find((r) => r.symbol === symbol);
        return {
          symbol,
          // Null rather than a zero age: never having produced a snapshot is
          // a different state from having produced a very old one.
          lastSnapshotAt: row ? Math.round(Number(row.ts)) : null,
          ageMs: row ? now - Number(row.ts) : null,
        };
      }),
      outcomes,
      jobs,
      // Null until the worker has published once. That is a cold start, not
      // a fault, and the page has to be able to tell those apart.
      worker: workerRuntime,
      serverTime: now,
    };
  });

  /**
   * Why a backlog cannot be priced — a separate route on purpose.
   *
   * /api/status is polled every 30 seconds by an open tab. These are
   * scans, and the answer they give changes on the scale of a backfill,
   * not of a poll, so the page fetches them only when someone asks.
   */
  app.get('/api/status/outcomes', async () => {
    const horizons: OutcomeHorizon[] = ['15m', '1h', '4h', '24h'];
    const nowMs = Date.now();

    const [coverage, samples, census] = await Promise.all([
      getPricingCandleCoverage(deps.pool),
      Promise.all(horizons.map((horizon) => getStuckOutcomeSample(deps.pool, horizon, nowMs))),
      Promise.all(horizons.map((horizon) => getStuckOutcomeCensus(deps.pool, horizon, nowMs))),
    ]);

    return {
      pricingCandles: coverage,
      stuck: horizons.map((horizon, i) => ({ horizon, rows: samples[i] ?? [] })),
      // Counted rather than inferred from the sample above: that sample is
      // oldest-first, and the oldest rows are the permanently dead ones.
      census,
      serverTime: nowMs,
    };
  });
}
