import type { FastifyInstance } from 'fastify';
import { getEnabledSymbols } from '@crypto-signal/db';
import { resolveBuildInfo } from '@crypto-signal/shared';
import type { ApiDeps } from '../deps.js';

// Resolved once at module load: this is the build that is running, and it
// cannot change without the process restarting.
const BUILD = resolveBuildInfo();

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
 *
 * It also reports which build is serving and which migration the database
 * is on, because "did my deploy land?" otherwise has no direct answer —
 * only indirect probes that require knowing in advance what changed.
 */
export function registerHealthRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/health', async (_req, reply) => {
    const checks: Record<string, unknown> = {};
    let healthy = true;

    // Deliberately outside `checks`: a missing commit variable says nothing
    // about whether the service is healthy, and must not be able to turn
    // the endpoint red.
    const version: Record<string, unknown> = {
      commit: BUILD.commit,
      commitSource: BUILD.commitSource,
      startedAt: BUILD.startedAt,
      uptimeMs: Date.now() - BUILD.startedAt,
    };

    try {
      await deps.pool.query('SELECT 1');
      checks['database'] = 'ok';
    } catch (err) {
      checks['database'] = { status: 'error', message: (err as Error).message };
      healthy = false;
    }

    try {
      // The schema version answers the other half of "did it land": api and
      // worker both migrate at boot, so the newest applied file tells you
      // whether the deploy carried its migrations through.
      const { rows: migrations } = await deps.pool.query(
        `SELECT filename, extract(epoch from applied_at)*1000 AS applied_ms
         FROM schema_migrations ORDER BY filename DESC LIMIT 1`,
      );
      const { rows: counted } = await deps.pool.query(`SELECT count(*)::int AS n FROM schema_migrations`);
      version['schema'] = {
        latest: migrations[0]?.filename ?? null,
        appliedAt: migrations[0]?.applied_ms == null ? null : Math.round(Number(migrations[0].applied_ms)),
        count: Number(counted[0]?.n ?? 0),
      };
    } catch {
      // A database that cannot be read is already reported by the check
      // above; not knowing the schema version on top of that is not a
      // second failure worth flagging.
      version['schema'] = null;
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

    reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'degraded', version, checks });
  });
}
