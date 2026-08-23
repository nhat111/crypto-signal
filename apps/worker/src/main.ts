import pg from 'pg';
import { createLogger, loadConfig } from '@crypto-signal/shared';
import { BinanceFuturesAdapter, BinanceSpotAdapter } from '@crypto-signal/market-data';
import { insertLiquidation } from '@crypto-signal/db';
import { buildStates, connectionStatusToState, type WorkerContext } from './context.js';
import { CandlePairBuffer } from './state.js';
import { SnapshotCache } from './redisCache.js';
import { TelegramNotifier } from './telegramNotifier.js';
import { processMatchedCandles } from './pipeline.js';
import { backfillHistory } from './backfill.js';
import { startSchedulers } from './scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('worker', config.logLevel);

  logger.info({ symbols: config.symbols, timeframes: config.timeframes }, 'starting worker');

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

  const ctx: WorkerContext = {
    pool,
    cache,
    notifier,
    logger,
    config,
    spotAdapter,
    futuresAdapter,
    states: buildStates(config.symbols, config.timeframes),
    pairBuffer: new CandlePairBuffer(),
    connectionStatus: { spot: 'connecting', futures: 'connecting', liquidation: 'connecting' },
    historicalScores: new Map(),
  };

  await backfillHistory(ctx);

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
    config.symbols,
    config.timeframes,
    (candle) => {
      const pair = ctx.pairBuffer.add(candle);
      if (pair) void processMatchedCandles(ctx, pair.spot, pair.futures).catch((err) => logger.error({ err }, 'pipeline error'));
    },
    (status) => {
      ctx.connectionStatus.futures = connectionStatusToState(status);
    },
  );

  const unsubscribeLiquidations = futuresAdapter.subscribeLiquidations(
    config.symbols,
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
