import type { Candle, OpenInterestPoint, SymbolId, Timeframe } from '@crypto-signal/shared';
import { computeFuturesOnlySnapshot, computeMarketSnapshot, computeTrueRange, type MarketSnapshot } from '@crypto-signal/indicators';
import { evaluateSignals, SEVERITY_ORDER, type Signal } from '@crypto-signal/signal-engine';
import { computeHealth, computeRisk, type HealthResult, type RiskResult } from '@crypto-signal/health-engine';
import {
  getAllAlertSubscribers,
  getLiquidationEventsInWindow,
  getPreviousOpenInterest,
  getRolling24hLiquidationUsd,
  insertAlertEvent,
  insertOpenInterest,
  insertSignal,
  getLastAlertEvent,
  saveFuturesMetrics,
  saveHealthSnapshot,
  saveSpotMetrics,
  upsertCandle,
} from '@crypto-signal/db';
import { assessDataQuality } from './dataQuality.js';
import { shouldSendAlert } from './alerting.js';
import { formatAlertMessage } from './telegramNotifier.js';
import { stateKey, type SymbolTimeframeState } from './state.js';
import type { WorkerContext } from './context.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface FuturesInputs {
  currentOI: OpenInterestPoint;
  previousOI: OpenInterestPoint | undefined;
  oiStale: boolean;
  fundingRateFraction: number;
  fundingStale: boolean;
  liquidationEvents: Awaited<ReturnType<typeof getLiquidationEventsInWindow>>;
  rollingLiquidation24hUsd: number;
  liquidationBaselineReady: boolean;
}

/** Everything that only depends on the futures candle — shared by both the normal (spot+futures) and futures-only pipelines. */
async function gatherFuturesInputs(ctx: WorkerContext, symbol: SymbolId, timeframe: Timeframe, futuresCandle: Candle): Promise<FuturesInputs> {
  let currentOI: OpenInterestPoint | undefined;
  let previousOI: OpenInterestPoint | undefined;
  try {
    const points = await ctx.futuresAdapter.fetchOpenInterestHist(symbol, timeframe, { limit: 2, endTime: futuresCandle.closeTime });
    previousOI = points[points.length - 2];
    currentOI = points[points.length - 1];
    if (currentOI) await insertOpenInterest(ctx.pool, currentOI);
  } catch (err) {
    ctx.logger.warn({ err, symbol, timeframe }, 'open interest fetch failed, falling back to last known value');
  }
  const oiStale = !currentOI;
  if (!currentOI) {
    currentOI = (await getPreviousOpenInterest(ctx.pool, symbol, timeframe, futuresCandle.closeTime + 1)) ?? {
      symbol,
      timeframe,
      timestamp: futuresCandle.closeTime,
      sumOpenInterest: 0,
      sumOpenInterestValue: 0,
    };
  }
  if (!previousOI) {
    previousOI = await getPreviousOpenInterest(ctx.pool, symbol, timeframe, currentOI.timestamp);
  }

  let fundingRateFraction = 0;
  let fundingStale = true;
  try {
    const premium = await ctx.futuresAdapter.fetchPremiumIndex(symbol);
    fundingRateFraction = premium.lastFundingRate;
    fundingStale = false;
  } catch (err) {
    ctx.logger.warn({ err, symbol }, 'funding fetch failed, treating as stale (0)');
  }

  const liquidationEvents = await getLiquidationEventsInWindow(ctx.pool, symbol, futuresCandle.openTime, futuresCandle.closeTime);
  const { totalUsd: rollingLiquidation24hUsd, earliestEventMs } = await getRolling24hLiquidationUsd(ctx.pool, symbol, futuresCandle.closeTime);
  const liquidationBaselineReady = earliestEventMs !== null && futuresCandle.closeTime - earliestEventMs >= DAY_MS * 0.9;

  return { currentOI, previousOI, oiStale, fundingRateFraction, fundingStale, liquidationEvents, rollingLiquidation24hUsd, liquidationBaselineReady };
}

/**
 * The shared tail once a MarketSnapshot exists, regardless of which
 * pipeline built it: signals, health/risk, persistence, alerts.
 * `health`/`risk` are null for futures-only symbols (no Spot data to score
 * Health against — see health-engine's computeHealth doc comment); Risk is
 * still fully computed since it never depended on Spot.
 */
async function finishSnapshot(ctx: WorkerContext, snapshot: MarketSnapshot): Promise<void> {
  const signals = evaluateSignals(snapshot, {
    thresholds: ctx.config.thresholds,
    confidenceWeights: ctx.config.confidenceWeights,
    getHistoricalScore: (type) => ctx.historicalScores.get(type),
  });

  const health = computeHealth(snapshot, signals, ctx.config.thresholds, ctx.config.healthWeights);
  const risk = computeRisk(snapshot, signals, ctx.config.thresholds, ctx.config.riskWeights);

  await saveHealthSnapshot(ctx.pool, snapshot, health, risk);

  for (const signal of signals) {
    const signalId = await insertSignal(ctx.pool, signal, {
      price: snapshot.price.close,
      healthScore: health?.score ?? null,
      riskScore: risk.score,
      spotCvd: snapshot.spot?.cvdCumulative ?? null,
      futuresCvd: snapshot.futures.cvdCumulative,
      openInterest: snapshot.futures.openInterest,
      fundingRate: snapshot.futures.fundingRate,
      volume: snapshot.futures.volume,
    });

    ctx.logger.info({ symbol: snapshot.symbol, timeframe: snapshot.timeframe, signalType: signal.signalType, severity: signal.severity, confidence: signal.confidence }, 'signal fired');

    await dispatchAlert(ctx, signal, signalId, health, risk);
  }
}

async function dispatchAlert(ctx: WorkerContext, signal: Signal, signalId: string, health: HealthResult | null, risk: RiskResult): Promise<void> {
  const lastAlert = await getLastAlertEvent(ctx.pool, signal.symbol, signal.timeframe, signal.signalType);
  const shouldAlert = shouldSendAlert(signal, lastAlert, ctx.config.alert.cooldownMinutes, ctx.config.alert.confidenceDeltaRetrigger, Date.now());
  if (!shouldAlert) return;

  const text = formatAlertMessage(signal, health, risk);

  // Subscribers = static env list (ALERT_CHAT_IDS) union chats that ran
  // /start and have alerts_enabled in bot_settings (spec §20 /alerts,
  // §21 cooldown applies per signal regardless of recipient count).
  const dbSubscribers = await getAllAlertSubscribers(ctx.pool);
  const minSeverityOk = (minSeverity: string): boolean =>
    SEVERITY_ORDER.indexOf(signal.severity) >= SEVERITY_ORDER.indexOf(minSeverity as Signal['severity']);
  // An empty `symbols` means "every tracked symbol" (migration 003) — without
  // that, a chat created before a symbol was added would never receive its
  // alerts.
  const dbChatIds = dbSubscribers
    .filter((s) => (s.symbols.length === 0 || s.symbols.includes(signal.symbol)) && minSeverityOk(s.minSeverity))
    .map((s) => s.chatId);
  const chatIds = Array.from(new Set([...ctx.config.telegramAlertChatIds, ...dbChatIds]));

  if (chatIds.length === 0) {
    // No subscribers yet — alert_events still gets a record (chat_id NULL)
    // so cooldown logic keeps working even before any chat has subscribed.
    await insertAlertEvent(ctx.pool, signalId, signal, null);
    return;
  }

  for (const chatId of chatIds) {
    await ctx.notifier.send(chatId, text);
    await insertAlertEvent(ctx.pool, signalId, signal, chatId);
  }
}

export async function processMatchedCandles(ctx: WorkerContext, spotCandle: Candle, futuresCandle: Candle): Promise<void> {
  const { symbol, timeframe } = futuresCandle;
  const state = ctx.states.get(stateKey(symbol, timeframe));
  if (!state) {
    // A dropped candle with no trace is how a symbol goes quiet without
    // anything looking wrong: the collector keeps running, the socket stays
    // open, and this symbol simply stops appearing in the database.
    ctx.logger.warn({ symbol, timeframe }, 'no state for symbol/timeframe — candle dropped');
    return;
  }

  const spotResult = state.spotGuard.accept(spotCandle);
  if (!spotResult.accepted) {
    ctx.logger.warn({ symbol, timeframe, market: 'spot', reason: spotResult.reason, openTime: spotCandle.openTime }, 'candle rejected by sequence guard');
    return;
  }
  const futuresResult = state.futuresGuard.accept(futuresCandle);
  if (!futuresResult.accepted) {
    ctx.logger.warn({ symbol, timeframe, market: 'futures', reason: futuresResult.reason, openTime: futuresCandle.openTime }, 'candle rejected by sequence guard');
    return;
  }

  await upsertCandle(ctx.pool, spotCandle);
  await upsertCandle(ctx.pool, futuresCandle);

  const inputs = await gatherFuturesInputs(ctx, symbol, timeframe, futuresCandle);

  const dataQuality = assessDataQuality(
    symbol,
    timeframe,
    {
      futuresWsHealthy: ctx.connectionStatus.futures === 'open',
      futuresGapCandles: futuresResult.gapCandles,
      openInterestStale: inputs.oiStale,
      fundingStale: inputs.fundingStale,
      liquidationBaselineReady: inputs.liquidationBaselineReady,
      spot: { wsHealthy: ctx.connectionStatus.spot === 'open', gapCandles: spotResult.gapCandles },
    },
    Date.now(),
  );

  const snapshot = computeMarketSnapshot({
    symbol,
    timeframe,
    spotCandle,
    futuresCandle,
    previousSpotCumulativeCvd: state.spotCumulativeCvd,
    previousFuturesCumulativeCvd: state.futuresCumulativeCvd,
    spotVolumeHistory: state.spotVolumeHistory,
    futuresVolumeHistory: state.futuresVolumeHistory,
    previousOpenInterest: inputs.previousOI,
    currentOpenInterest: inputs.currentOI,
    fundingRateFraction: inputs.fundingRateFraction,
    liquidationEventsInWindow: inputs.liquidationEvents,
    rollingLiquidation24hUsd: inputs.rollingLiquidation24hUsd,
    previousFuturesClose: state.previousFuturesClose,
    recentTrueRanges: state.recentTrueRanges,
    dataQuality,
    thresholds: ctx.config.thresholds,
  });

  updateStateAfterSnapshot(state, snapshot, spotCandle, futuresCandle);

  await saveSpotMetrics(ctx.pool, snapshot);
  await saveFuturesMetrics(ctx.pool, snapshot);

  await finishSnapshot(ctx, snapshot);
}

/** For symbols with only a Binance Futures listing — spec §7 divergence signals and Health Score are unavailable (see MarketSnapshot's doc comment / ASSUMPTIONS.md §15). */
export async function processFuturesOnlyCandle(ctx: WorkerContext, futuresCandle: Candle): Promise<void> {
  const { symbol, timeframe } = futuresCandle;
  const state = ctx.states.get(stateKey(symbol, timeframe));
  if (!state) {
    // A dropped candle with no trace is how a symbol goes quiet without
    // anything looking wrong: the collector keeps running, the socket stays
    // open, and this symbol simply stops appearing in the database.
    ctx.logger.warn({ symbol, timeframe }, 'no state for symbol/timeframe — candle dropped');
    return;
  }

  const futuresResult = state.futuresGuard.accept(futuresCandle);
  if (!futuresResult.accepted) {
    ctx.logger.warn({ symbol, timeframe, market: 'futures', reason: futuresResult.reason, openTime: futuresCandle.openTime }, 'candle rejected by sequence guard');
    return;
  }

  await upsertCandle(ctx.pool, futuresCandle);

  const inputs = await gatherFuturesInputs(ctx, symbol, timeframe, futuresCandle);

  const dataQuality = assessDataQuality(
    symbol,
    timeframe,
    {
      futuresWsHealthy: ctx.connectionStatus.futures === 'open',
      futuresGapCandles: futuresResult.gapCandles,
      openInterestStale: inputs.oiStale,
      fundingStale: inputs.fundingStale,
      liquidationBaselineReady: inputs.liquidationBaselineReady,
      // no `spot` field — this is exactly what marks the symbol as futures-only in dataQuality.issues.
    },
    Date.now(),
  );

  const snapshot = computeFuturesOnlySnapshot({
    symbol,
    timeframe,
    futuresCandle,
    previousFuturesCumulativeCvd: state.futuresCumulativeCvd,
    futuresVolumeHistory: state.futuresVolumeHistory,
    previousOpenInterest: inputs.previousOI,
    currentOpenInterest: inputs.currentOI,
    fundingRateFraction: inputs.fundingRateFraction,
    liquidationEventsInWindow: inputs.liquidationEvents,
    rollingLiquidation24hUsd: inputs.rollingLiquidation24hUsd,
    previousFuturesClose: state.previousFuturesClose,
    recentTrueRanges: state.recentTrueRanges,
    dataQuality,
    thresholds: ctx.config.thresholds,
  });

  updateStateAfterSnapshot(state, snapshot, null, futuresCandle);

  await saveFuturesMetrics(ctx.pool, snapshot);

  await finishSnapshot(ctx, snapshot);
}

function updateStateAfterSnapshot(state: SymbolTimeframeState, snapshot: MarketSnapshot, spotCandle: Candle | null, futuresCandle: Candle): void {
  if (snapshot.spot && spotCandle) {
    state.spotCumulativeCvd = snapshot.spot.cvdCumulative;
    state.pushVolumeHistory('spot', spotCandle.volume);
  }
  state.futuresCumulativeCvd = snapshot.futures.cvdCumulative;
  state.pushVolumeHistory('futures', futuresCandle.volume);
  state.pushTrueRange(computeTrueRange(futuresCandle, state.previousFuturesClose));
  state.previousFuturesClose = futuresCandle.close;
  state.lastProcessedOpenTime = futuresCandle.openTime;
}
