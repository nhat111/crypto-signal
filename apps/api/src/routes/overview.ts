import type { FastifyInstance } from 'fastify';
import { getOverview } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/** Backs the market overview cards + heatmap (spec §17/§19). */
export function registerOverviewRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/overview', async () => {
    const rows = await getOverview(deps.pool, deps.config.symbols, deps.config.timeframes);
    return {
      symbols: deps.config.symbols,
      timeframes: deps.config.timeframes,
      rows,
    };
  });
}
