import { buildCvdSeries, computeTrueRange } from '@crypto-signal/indicators';
import { ensureSymbol, getLatestCumulativeCvd, insertFundingRate, insertOpenInterest, upsertCandle } from '@crypto-signal/db';
import { stateKey } from './state.js';
import type { WorkerContext } from './context.js';

const BACKFILL_CANDLES = 100;

/**
 * Seeds each (symbol, timeframe) with enough history that the very first
 * live candle already has a meaningful volume average / ATR / CVD baseline
 * instead of a cold-start distortion. Also seeds sequence guards so the
 * first live WS candle isn't misread as a gap.
 *
 * Futures-only symbols (ctx.futuresOnlySymbolSet — no Binance Spot listing,
 * e.g. HYPEUSDT) skip every spot-side fetch entirely rather than fetching
 * and discarding — see ASSUMPTIONS.md §15.
 */
export async function backfillHistory(ctx: WorkerContext): Promise<void> {
  const allSymbols = [...ctx.config.symbols, ...ctx.config.futuresOnlySymbols];

  for (const symbol of allSymbols) {
    await ensureSymbol(ctx.pool, symbol);
    const isFuturesOnly = ctx.futuresOnlySymbolSet.has(symbol);

    for (const timeframe of ctx.config.timeframes) {
      const state = ctx.states.get(stateKey(symbol, timeframe));
      if (!state) continue;

      try {
        const [spotCandles, futuresCandles] = await Promise.all([
          isFuturesOnly ? Promise.resolve([]) : ctx.spotAdapter.fetchKlines(symbol, timeframe, { limit: BACKFILL_CANDLES }),
          ctx.futuresAdapter.fetchKlines(symbol, timeframe, { limit: BACKFILL_CANDLES }),
        ]);

        for (const candle of spotCandles) {
          await upsertCandle(ctx.pool, candle);
          state.pushVolumeHistory('spot', candle.volume);
        }
        for (const candle of futuresCandles) {
          await upsertCandle(ctx.pool, candle);
          state.pushVolumeHistory('futures', candle.volume);
        }

        let previousClose: number | undefined;
        for (const candle of futuresCandles) {
          state.pushTrueRange(computeTrueRange(candle, previousClose));
          previousClose = candle.close;
        }
        state.previousFuturesClose = previousClose;

        if (!isFuturesOnly) {
          state.spotCumulativeCvd = await getLatestCumulativeCvd(ctx.pool, symbol, 'spot', timeframe);
          if (state.spotCumulativeCvd === 0 && spotCandles.length > 0) {
            state.spotCumulativeCvd = buildCvdSeries(spotCandles).at(-1)?.cumulative ?? 0;
          }
        }
        state.futuresCumulativeCvd = await getLatestCumulativeCvd(ctx.pool, symbol, 'futures', timeframe);
        if (state.futuresCumulativeCvd === 0 && futuresCandles.length > 0) {
          state.futuresCumulativeCvd = buildCvdSeries(futuresCandles).at(-1)?.cumulative ?? 0;
        }

        const lastSpot = spotCandles.at(-1);
        if (lastSpot) state.spotGuard.accept(lastSpot);
        const lastFutures = futuresCandles.at(-1);
        if (lastFutures) state.futuresGuard.accept(lastFutures);

        const oiHistory = await ctx.futuresAdapter.fetchOpenInterestHist(symbol, timeframe, { limit: BACKFILL_CANDLES });
        for (const point of oiHistory) await insertOpenInterest(ctx.pool, point);

        ctx.logger.info(
          { symbol, timeframe, futuresOnly: isFuturesOnly, spotCandles: spotCandles.length, futuresCandles: futuresCandles.length, oiPoints: oiHistory.length },
          'backfill complete',
        );
      } catch (err) {
        ctx.logger.error({ err, symbol, timeframe }, 'backfill failed — will keep running, live data will catch up');
      }
    }

    try {
      const fundingHistory = await ctx.futuresAdapter.fetchFundingRateHistory(symbol, { limit: BACKFILL_CANDLES });
      for (const point of fundingHistory) await insertFundingRate(ctx.pool, point);
    } catch (err) {
      ctx.logger.error({ err, symbol }, 'funding rate backfill failed');
    }
  }
}
