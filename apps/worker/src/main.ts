import pg from 'pg';
import { createLogger, loadConfig, resolveBuildInfo } from '@crypto-signal/shared';
import { BinanceFuturesAdapter, BinanceSpotAdapter } from '@crypto-signal/market-data';
import { insertLiquidation } from '@crypto-signal/db';
import { loadGemConfig } from '@crypto-signal/gem-scanner';
import { buildStates, connectionStatusToState, type WorkerContext } from './context.js';
import { CandlePairBuffer } from './state.js';
import { TelegramNotifier } from './telegramNotifier.js';
import { processFuturesOnlyCandle, processMatchedCandles } from './pipeline.js';
import { backfillHistory, registerSymbols } from './backfill.js';
import { maybeBackfillOnBoot } from './backfillOnBoot.js';
import { startSchedulers } from './scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('worker', config.logLevel);

  const gemConfig = loadGemConfig();

  // The worker has no HTTP surface, so its build is only knowable from
  // this line. Without it, "is the worker running the new code?" can only
  // be answered by watching for a behaviour change, which is exactly the
  // guesswork /health's version block exists to remove on the api side.
  const build = resolveBuildInfo();

  logger.info(
    {
      commit: build.commit,
      commitSource: build.commitSource,
      symbols: config.symbols,
      futuresOnlySymbols: config.futuresOnlySymbols,
      timeframes: config.timeframes,
      gemScan: gemConfig.enabled ? gemConfig.chains : 'disabled',
    },
    'starting worker',
  );

  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
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

  // Registration first: a symbol must be visible to the read side even if
  // its history backfill later fails.
  await registerSymbols(ctx);
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

  // Deliberately after the collector is live and not awaited: the replay
  // makes hundreds of upstream requests and can run for minutes, and live
  // candle collection must not wait on it. Its own error handling is
  // inside — nothing it does can take the worker down.
  void maybeBackfillOnBoot(
    {
      pool,
      logger,
      symbols: allSymbols,
      timeframes: config.timeframes,
      deps: {
        pool,
        spotAdapter,
        futuresAdapter,
        thresholds: config.thresholds,
        healthWeights: config.healthWeights,
        riskWeights: config.riskWeights,
        confidenceWeights: config.confidenceWeights,
        futuresOnlySymbolSet: ctx.futuresOnlySymbolSet,
        logger,
      },
    },
    process.env.BACKFILL_DAYS,
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down worker');
    stopSchedulers();
    unsubscribeSpot();
    unsubscribeFutures();
    unsubscribeLiquidations();
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
