import type { FastifyInstance } from 'fastify';
import { getEnabledSymbols, getLatestSymbolState, getRecentCandles, getRecentSignals, getSymbolTimeseries } from '@crypto-signal/db';
import { computeBollingerBands, type BollingerBands } from '@crypto-signal/indicators';
import type { Timeframe } from '@crypto-signal/shared';
import type { ApiDeps } from '../deps.js';

/**
 * 20 closed candles back, on the same futures series `price.close` already
 * comes from (MarketSnapshot's price is the futures candle, not spot — see
 * indicators/src/snapshot.ts). A reference range, not a signal: computed
 * fresh from market_candles on every request rather than threaded through
 * the write pipeline, since nothing scores or alerts on it.
 */
const BOLLINGER_PERIOD = 20;

interface SymbolQuery {
  timeframe?: string;
  limit?: string;
}

/** Symbol Detail page (spec §18): current state header + full timeseries for all 8 charts + recent signals for markers. */
export function registerSymbolRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get<{ Params: { symbol: string }; Querystring: SymbolQuery }>('/api/symbols/:symbol', async (req, reply) => {
    const symbol = req.params.symbol.toUpperCase();
    const knownSymbols = await getEnabledSymbols(deps.pool);
    if (!knownSymbols.includes(symbol)) {
      return reply.code(404).send({ error: `Unknown symbol ${symbol}` });
    }
    const timeframe = (req.query.timeframe ?? '15m') as Timeframe;
    if (!deps.config.timeframes.includes(timeframe)) {
      return reply.code(400).send({ error: `Unknown timeframe ${timeframe}` });
    }
    const limit = Math.min(1000, Number(req.query.limit ?? 200));

    const [latest, series, signals, recentCandles] = await Promise.all([
      getLatestSymbolState(deps.pool, symbol, timeframe),
      getSymbolTimeseries(deps.pool, symbol, timeframe, limit),
      getRecentSignals(deps.pool, { symbol, timeframe, limit: 20 }),
      getRecentCandles(deps.pool, symbol, 'futures', timeframe, BOLLINGER_PERIOD),
    ]);

    const priceLevels: BollingerBands | null = computeBollingerBands(
      recentCandles.map((c) => c.close),
      BOLLINGER_PERIOD,
    );

    return { symbol, timeframe, latest: latest ?? null, series, signals, priceLevels };
  });
}
