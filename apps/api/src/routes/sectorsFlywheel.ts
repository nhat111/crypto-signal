import type { FastifyInstance } from 'fastify';
import { JOB_FLYWHEEL_SCAN, JOB_SECTOR_SCAN, getJobHealth, getLatestFlywheel, getLatestSectors, type JobHealth } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * Sector read and flywheel list (ASSUMPTIONS.md §26): what the worker
 * stored for the latest day, plus whether the job behind it is working,
 * read the same way as on /api/flow.
 */
function fetchHealth(health: JobHealth | undefined) {
  return health
    ? {
        lastAttemptAt: health.lastAttemptAt,
        lastSuccessAt: health.lastSuccessAt,
        consecutiveFailures: health.consecutiveFailures,
        lastError: health.lastError,
      }
    : null;
}

export function registerSectorFlywheelRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/sectors', async () => {
    const [latest, health] = await Promise.all([getLatestSectors(deps.pool), getJobHealth(deps.pool, JOB_SECTOR_SCAN)]);
    return { enabled: deps.config.sectors.enabled, day: latest.day, sectors: latest.sectors, fetch: fetchHealth(health), serverTime: Date.now() };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/flywheel', async (req) => {
    const limit = req.query.limit !== undefined ? Math.min(200, Math.max(1, Number(req.query.limit) || 100)) : 100;
    const [latest, health] = await Promise.all([getLatestFlywheel(deps.pool, limit), getJobHealth(deps.pool, JOB_FLYWHEEL_SCAN)]);
    return { enabled: deps.config.flywheel.enabled, day: latest.day, rows: latest.rows, fetch: fetchHealth(health), serverTime: Date.now() };
  });
}
