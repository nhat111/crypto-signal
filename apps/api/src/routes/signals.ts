import type { FastifyInstance } from 'fastify';
import { getRecentSignals, getSignalVerdicts } from '@crypto-signal/db';
import type { ApiDeps } from '../deps.js';

interface SignalsQuery {
  symbol?: string;
  timeframe?: string;
  signalType?: string;
  limit?: string;
}

export function registerSignalsRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Querystring: SignalsQuery }>('/api/signals', async (req) => {
    const [rows, verdicts] = await Promise.all([
      getRecentSignals(deps.pool, {
        symbol: req.query.symbol?.toUpperCase(),
        timeframe: req.query.timeframe,
        signalType: req.query.signalType,
        limit: Math.min(500, Number(req.query.limit ?? 50)),
      }),
      // Sent alongside rather than joined per row: there are nine types and
      // up to five hundred signals, so a verdict per row would repeat the
      // same handful of objects a hundred times over the wire.
      getSignalVerdicts(deps.pool).catch(() => []),
    ]);
    return { signals: rows, verdicts };
  });

  /**
   * What the recorded outcomes have concluded about each signal type.
   *
   * Read from the cache the worker refreshes hourly, not recomputed: the
   * baseline behind it is a lateral join across every 5m candle in the
   * window, which is not something a dashboard poll should be running.
   */
  app.get('/api/signal-verdicts', async () => {
    const verdicts = await getSignalVerdicts(deps.pool);
    return { verdicts };
  });
}
