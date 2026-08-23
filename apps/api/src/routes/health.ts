import type { FastifyInstance } from 'fastify';
import type { ApiDeps } from '../deps.js';

/** Spec §11 "health check endpoint": DB reachability + how fresh the most recent computed snapshot is, per configured symbol/timeframe. */
export function registerHealthRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/health', async (_req, reply) => {
    const checks: Record<string, unknown> = {};
    let healthy = true;

    try {
      await deps.pool.query('SELECT 1');
      checks['database'] = 'ok';
    } catch (err) {
      checks['database'] = { status: 'error', message: (err as Error).message };
      healthy = false;
    }

    try {
      const { rows } = await deps.pool.query(
        `SELECT symbol, timeframe, extract(epoch from timestamp)*1000 AS ts
         FROM market_health_snapshots
         WHERE symbol = ANY($1) AND timeframe = ANY($2)
         ORDER BY timestamp DESC LIMIT 1`,
        [deps.config.symbols, deps.config.timeframes],
      );
      const latest = rows[0];
      if (!latest) {
        checks['collector'] = { status: 'no_data_yet' };
      } else {
        const ageMs = Date.now() - Number(latest.ts);
        const stale = ageMs > 15 * 60_000;
        checks['collector'] = { status: stale ? 'stale' : 'ok', ageMs, lastSymbol: latest.symbol, lastTimeframe: latest.timeframe };
        if (stale) healthy = false;
      }
    } catch (err) {
      checks['collector'] = { status: 'error', message: (err as Error).message };
      healthy = false;
    }

    reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
  });
}
