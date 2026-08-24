import type { FastifyInstance } from 'fastify';
import { getEnabledSymbols } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

/**
 * Spec §11 "health check endpoint": DB reachability + how fresh the most
 * recent computed snapshot is.
 *
 * It also reports the registered symbol list and per-symbol snapshot
 * freshness. That exists because "I added a symbol and it never appeared"
 * is otherwise invisible from outside: without it you cannot tell whether
 * the worker never registered the symbol, or registered it but has not
 * produced a snapshot for it yet — two problems with completely different
 * fixes.
 */
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
      const symbols = await getEnabledSymbols(deps.pool);
      checks['symbols'] = symbols;

      const { rows } = await deps.pool.query(
        `SELECT DISTINCT ON (symbol) symbol, timeframe, extract(epoch from timestamp)*1000 AS ts
         FROM market_health_snapshots
         WHERE symbol = ANY($1) AND timeframe = ANY($2)
         ORDER BY symbol, timestamp DESC`,
        [symbols, deps.config.timeframes],
      );

      const now = Date.now();
      const perSymbol: Record<string, unknown> = {};
      for (const symbol of symbols) {
        const row = rows.find((r) => r.symbol === symbol);
        perSymbol[symbol] = row
          ? { status: now - Number(row.ts) > 15 * 60_000 ? 'stale' : 'ok', ageMs: now - Number(row.ts) }
          : { status: 'no_data_yet' };
      }
      checks['symbolFreshness'] = perSymbol;

      const newest = rows.reduce<number | null>((max, r) => Math.max(max ?? 0, Number(r.ts)), null);
      if (newest === null) {
        checks['collector'] = { status: 'no_data_yet' };
      } else {
        const ageMs = now - newest;
        const stale = ageMs > 15 * 60_000;
        checks['collector'] = { status: stale ? 'stale' : 'ok', ageMs };
        if (stale) healthy = false;
      }
    } catch (err) {
      checks['collector'] = { status: 'error', message: (err as Error).message };
      healthy = false;
    }

    reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', checks });
  });
}
