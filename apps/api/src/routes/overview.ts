import type { FastifyInstance } from 'fastify';
import { getEnabledSymbols, getOverview } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * Backs the market overview cards + heatmap (spec §17/§19).
 *
 * The symbol list comes from the database (what the collector actually
 * registered), not from this service's own env — see getEnabledSymbols.
 * That's what lets a futures-only symbol be added by setting
 * FUTURES_ONLY_SYMBOLS on the worker alone.
 */
export function registerOverviewRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/overview', async () => {
    const symbols = await getEnabledSymbols(deps.pool);
    const rows = await getOverview(deps.pool, symbols, deps.config.timeframes);
    return {
      symbols,
      timeframes: deps.config.timeframes,
      rows,
    };
  });
}
