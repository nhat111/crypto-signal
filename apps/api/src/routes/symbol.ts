import type { FastifyInstance } from 'fastify';
import { getLatestSymbolState, getRecentSignals, getSymbolTimeseries } from '@crypto-signal/db';
import type { Timeframe } from '@crypto-signal/shared';
import type { ApiDeps } from '../deps.js';

interface SymbolQuery {
  timeframe?: string;
  limit?: string;
}

/** Symbol Detail page (spec §18): current state header + full timeseries for all 8 charts + recent signals for markers. */
export function registerSymbolRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Params: { symbol: string }; Querystring: SymbolQuery }>('/api/symbols/:symbol', async (req, reply) => {
    const symbol = req.params.symbol.toUpperCase();
    if (!deps.config.symbols.includes(symbol)) {
      return reply.code(404).send({ error: `Unknown symbol ${symbol}` });
    }
    const timeframe = (req.query.timeframe ?? '15m') as Timeframe;
    if (!deps.config.timeframes.includes(timeframe)) {
      return reply.code(400).send({ error: `Unknown timeframe ${timeframe}` });
    }
    const limit = Math.min(1000, Number(req.query.limit ?? 200));

    const [latest, series, signals] = await Promise.all([
      getLatestSymbolState(deps.pool, symbol, timeframe),
      getSymbolTimeseries(deps.pool, symbol, timeframe, limit),
      getRecentSignals(deps.pool, { symbol, timeframe, limit: 20 }),
    ]);

    return { symbol, timeframe, latest: latest ?? null, series, signals };
  });
}
