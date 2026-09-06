import type { FastifyInstance } from 'fastify';
import { createLogger } from '@crypto-signal/shared';
import { BinanceSpotAdapter } from '@crypto-signal/market-data';
import {
  CompositeSafetySource,
  DexScreenerSource,
  GoPlusSource,
  RugCheckSource,
} from '@crypto-signal/gem-scanner';
import { runLookup } from '@crypto-signal/lookup';
import type { ApiDeps } from '../deps.js';

/**
 * On-demand analysis of anything, rather than only what the collector
 * tracks.
 *
 * Every other route reads what the worker already persisted. This one
 * calls out to Binance and DexScreener while the request is open, because
 * the whole point is answering about a symbol nobody subscribed to and a
 * token nobody scanned. That makes it the only route whose latency depends
 * on somebody else's API, and the only one a user can trigger repeatedly —
 * so the work is bounded: one kline request per quote asset tried, one
 * search, one safety screen.
 *
 * Nothing is written to the database. A lookup is a question, not an
 * observation the scanner made, and mixing the two would put tokens
 * nobody screened into the same tables the performance numbers come from.
 */
export function registerLookupRoute(app: FastifyInstance, deps: ApiDeps): void {
  const logger = createLogger('lookup', deps.config.logLevel);

  const spot = new BinanceSpotAdapter({
    restBase: deps.config.binance.spotRestBase,
    wsBase: deps.config.binance.spotWsBase,
    logger,
  });
  const dexscreener = new DexScreenerSource({ logger });
  const safety = new CompositeSafetySource(
    [new RugCheckSource({ logger, apiKey: deps.gemConfig?.rugcheckApiKey || undefined }), new GoPlusSource({ logger })],
    logger,
  );

  app.get<{ Querystring: { q?: string; timeframe?: string } }>('/api/lookup', async (req, reply) => {
    const q = req.query.q?.trim() ?? '';
    if (q === '') return reply.code(400).send({ error: 'thiếu tham số q' });

    const timeframe = deps.config.timeframes.includes(req.query.timeframe as never)
      ? (req.query.timeframe as string)
      : '4h';

    const result = await runLookup(
      {
        async fetchBars(symbol, tf, limit) {
          const candles = await spot.fetchKlines(symbol, tf as never, { limit });
          return candles.map((c) => ({
            openTime: c.openTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          }));
        },
        searchPairs: (query) => dexscreener.searchPairs(query),
        // supportsChain first: the composite answers `unknown` for a chain
        // nothing covers, and null is what says "no screen ran" rather
        // than "a screen ran and found nothing".
        screen: async (chainId, tokenAddress) =>
          safety.supportsChain(chainId) ? safety.screen(chainId, tokenAddress) : null,
        logger,
      },
      q,
      { timeframe },
    );

    if (result.kind === 'not_found') return reply.code(404).send({ error: result.reason, query: q });
    return { query: q, timeframe, result };
  });
}
