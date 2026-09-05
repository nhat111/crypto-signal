import pg from 'pg';
import { createLogger, loadConfig, resolveBuildInfo } from '@crypto-signal/shared';
import { BinanceFuturesAdapter, BinanceSpotAdapter } from '@crypto-signal/market-data';
import { getWorkerRuntime, insertLiquidation, recordServiceBuild, SERVICE_WORKER } from '@crypto-signal/db';
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
  const notifier = new TelegramNotifier(config.telegramBotToken, logger, config.telegramApiRoot);

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
    symbolIngest: {},
    connectionStatus: { spot: 'connecting', futures: 'connecting', liquidation: 'connecting' },
    historicalScores: new Map(),
    signalVerdicts: new Map(),
    gemConfig: gemConfig.enabled ? gemConfig : null,
  };

  // Written before anything that can fail: after a deploy the first
  // question is "did the worker roll over?", and it must be answerable even
  // if Binance is unreachable and the rest of startup falls over.
  await recordServiceBuild(pool, SERVICE_WORKER, build).catch((err) =>
    logger.warn({ err }, 'could not record worker build — version will not show on /status'),
  );

  // Carry the last-candle-seen times across the restart.
  //
  // This map is what tells "no candle is arriving" (a connection fault)
  // apart from "candles arrive and nothing comes out" (our bug) — and it
  // lived only in memory, so the heartbeat overwrote the stored copy with
  // an empty object on every boot. Every deploy destroyed the one piece of
  // evidence that identifies a stalled symbol, which is why HYPEUSDT sat
  // at "chưa rõ" for days: nobody was ever looking more than a few minutes
  // after a deploy.
  //
  // Seeding is honest here because the question is "when did a candle for
  // this symbol last arrive", and that answer does not reset because a
  // process did.
  const previousRuntime = await getWorkerRuntime(pool).catch(() => null);
  if (previousRuntime) Object.assign(ctx.symbolIngest, previousRuntime.symbolIngest);

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
      // Stamped first, before every branch below. A candle that arrives and
      // is then dropped must still count as arrived, or this measurement
      // answers the same question the snapshot already answers.
      ctx.symbolIngest[candle.symbol] = Date.now();
      if (ctx.futuresOnlySymbolSet.has(candle.symbol)) {
        // Symbol and timeframe on the error, not just the stack: one symbol
        // can fail upstream for hours while the rest keep collecting, and a
        // bare 'pipeline error' gives no way to tell which one stopped.
        void processFuturesOnlyCandle(ctx, candle).catch((err) =>
          logger.error({ err, symbol: candle.symbol, timeframe: candle.timeframe }, 'pipeline error'),
        );
        return;
      }
      const pair = ctx.pairBuffer.add(candle);
      if (pair)
        void processMatchedCandles(ctx, pair.spot, pair.futures).catch((err) =>
          logger.error({ err, symbol: pair.futures.symbol, timeframe: pair.futures.timeframe }, 'pipeline error'),
        );
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
    process.env.BACKFILL_FORCE,
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
