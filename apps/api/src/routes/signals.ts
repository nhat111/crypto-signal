import type { FastifyInstance } from 'fastify';
import { getRecentSignals } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

interface SignalsQuery {
  symbol?: string;
  timeframe?: string;
  signalType?: string;
  limit?: string;
}

export function registerSignalsRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: SignalsQuery }>('/api/signals', async (req) => {
    const rows = await getRecentSignals(deps.pool, {
      symbol: req.query.symbol?.toUpperCase(),
      timeframe: req.query.timeframe,
      signalType: req.query.signalType,
      limit: Math.min(500, Number(req.query.limit ?? 50)),
    });
    return { signals: rows };
  });
}
