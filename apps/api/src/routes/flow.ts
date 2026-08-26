import type { FastifyInstance } from 'fastify';
import { getRecentStablecoinSupply } from '@crypto-signal/db';
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
    const points = await getRecentStablecoinSupply(deps.pool, HISTORY_DAYS);
    // Null until the worker's first refresh lands — the UI must say "no data
    // yet" rather than render a zeroed reading.
    return { stablecoin: computeStablecoinFlow(points) };
  });
}
