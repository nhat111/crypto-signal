import pg from 'pg';
import { createLogger, loadConfig } from '@crypto-signal/shared';
import { BinanceFuturesAdapter, BinanceSpotAdapter } from '@crypto-signal/market-data';
import { insertLiquidation } from '@crypto-signal/db';
import { loadGemConfig } from '@crypto-signal/gem-scanner';
import { buildStates, connectionStatusToState, type WorkerContext } from './context.js';
import { CandlePairBuffer } from './state.js';
import { SnapshotCache } from './redisCache.js';
import { TelegramNotifier } from './telegramNotifier.js';
import { processFuturesOnlyCandle, processMatchedCandles } from './pipeline.js';
import { backfillHistory } from './backfill.js';
import { startSchedulers } from './scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('worker', config.logLevel);

  const gemConfig = loadGemConfig();

  logger.info(
    {
      symbols: config.symbols,
      futuresOnlySymbols: config.futuresOnlySymbols,
      timeframes: config.timeframes,
      gemScan: gemConfig.enabled ? gemConfig.chains : 'disabled',
    },
    'starting worker',
  );

  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const cache = new SnapshotCache(config.redisUrl);
  try {
    await cache.connect();
  } catch (err) {
    logger.warn({ err }, 'redis connect failed at startup — snapshot cache will stay best-effort/disabled');
  }

  const notifier = new TelegramNotifier(config.telegramBotToken, logger);

  const spotAdapter = new BinanceSpotAdapter({
    restBase: config.binance.spotRestBase,
    wsBase: config.binance.spotWsBase,
    logger,
  });
  const futuresAdapter = new BinanceFuturesAdapter({
    restBase: config.binance.futuresRestBase,
    wsBase: config.binance.futuresWsBase,
    logger,
  });

  const allSymbols = [...config.symbols, ...config.futuresOnlySymbols];

  const ctx: WorkerContext = {
    pool,
    cache,
    notifier,
    logger,
    config,
    spotAdapter,
    futuresAdapter,
    states: buildStates(allSymbols, config.timeframes),
    pairBuffer: new CandlePairBuffer(),
    futuresOnlySymbolSet: new Set(config.futuresOnlySymbols),
    connectionStatus: { spot: 'connecting', futures: 'connecting', liquidation: 'connecting' },
    historicalScores: new Map(),
    gemConfig: gemConfig.enabled ? gemConfig : null,
  };

  await backfillHistory(ctx);

  // Spot WS only ever subscribes to symbols known to have a Spot listing —
  // a futures-only symbol in this list would risk the combined-stream
  // connection rejecting the whole subscription (ASSUMPTIONS.md §15).
  const unsubscribeSpot = spotAdapter.subscribeKlines(
    config.symbols,
    config.timeframes,
    (candle) => {
      const pair = ctx.pairBuffer.add(candle);
      if (pair) void processMatchedCandles(ctx, pair.spot, pair.futures).catch((err) => logger.error({ err }, 'pipeline error'));
    },
    (status) => {
      ctx.connectionStatus.spot = connectionStatusToState(status);
    },
  );

  const unsubscribeFutures = futuresAdapter.subscribeKlines(
    allSymbols,
    config.timeframes,
    (candle) => {
      if (ctx.futuresOnlySymbolSet.has(candle.symbol)) {
        void processFuturesOnlyCandle(ctx, candle).catch((err) => logger.error({ err }, 'pipeline error'));
        return;
      }
      const pair = ctx.pairBuffer.add(candle);
      if (pair) void processMatchedCandles(ctx, pair.spot, pair.futures).catch((err) => logger.error({ err }, 'pipeline error'));
    },
    (status) => {
      ctx.connectionStatus.futures = connectionStatusToState(status);
    },
  );

  const unsubscribeLiquidations = futuresAdapter.subscribeLiquidations(
    allSymbols,
    (event) => {
      void insertLiquidation(pool, event).catch((err) => logger.error({ err }, 'failed to persist liquidation event'));
    },
    (status) => {
      ctx.connectionStatus.liquidation = connectionStatusToState(status);
    },
  );

  const stopSchedulers = startSchedulers(ctx);

  logger.info('worker is running');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down worker');
    stopSchedulers();
    unsubscribeSpot();
    unsubscribeFutures();
    unsubscribeLiquidations();
    await cache.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('worker failed to start', err);
  process.exit(1);
});
