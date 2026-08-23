import type { Candle } from '@crypto-signal/shared';
import type { OpenInterestPoint } from '@crypto-signal/shared';
import { computeMarketSnapshot, computeTrueRange } from '@crypto-signal/indicators';
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
import { stateKey } from './state.js';
import type { WorkerContext } from './context.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function processMatchedCandles(ctx: WorkerContext, spotCandle: Candle, futuresCandle: Candle): Promise<void> {
  const { symbol, timeframe } = futuresCandle;
  const key = stateKey(symbol, timeframe);
  const state = ctx.states.get(key);
  if (!state) return;

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

  const dataQuality = assessDataQuality(
    symbol,
    timeframe,
    {
      spotWsHealthy: ctx.connectionStatus.spot === 'open',
      futuresWsHealthy: ctx.connectionStatus.futures === 'open',
      spotGapCandles: spotResult.gapCandles,
      futuresGapCandles: futuresResult.gapCandles,
      openInterestStale: oiStale,
      fundingStale,
      liquidationBaselineReady,
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
    previousOpenInterest: previousOI,
    currentOpenInterest: currentOI,
    fundingRateFraction,
    liquidationEventsInWindow: liquidationEvents,
    rollingLiquidation24hUsd,
    previousFuturesClose: state.previousFuturesClose,
    recentTrueRanges: state.recentTrueRanges,
    dataQuality,
    thresholds: ctx.config.thresholds,
  });

  state.spotCumulativeCvd = snapshot.spot.cvdCumulative;
  state.futuresCumulativeCvd = snapshot.futures.cvdCumulative;
  state.pushVolumeHistory('spot', spotCandle.volume);
  state.pushVolumeHistory('futures', futuresCandle.volume);
  state.pushTrueRange(computeTrueRange(futuresCandle, state.previousFuturesClose));
  state.previousFuturesClose = futuresCandle.close;
  state.lastProcessedOpenTime = futuresCandle.openTime;

  await saveSpotMetrics(ctx.pool, snapshot);
  await saveFuturesMetrics(ctx.pool, snapshot);

  const signals = evaluateSignals(snapshot, {
    thresholds: ctx.config.thresholds,
    confidenceWeights: ctx.config.confidenceWeights,
    getHistoricalScore: (type) => ctx.historicalScores.get(type),
  });

  const health = computeHealth(snapshot, signals, ctx.config.thresholds, ctx.config.healthWeights);
  const risk = computeRisk(snapshot, signals, ctx.config.thresholds, ctx.config.riskWeights);

  await saveHealthSnapshot(ctx.pool, snapshot, health, risk);

  try {
    await ctx.cache.set({ snapshot, health, risk, signals, updatedAt: Date.now() });
  } catch (err) {
    ctx.logger.warn({ err }, 'redis cache set failed (non-fatal)');
  }

  for (const signal of signals) {
    const signalId = await insertSignal(ctx.pool, signal, {
      price: snapshot.price.close,
      healthScore: health.score,
      riskScore: risk.score,
      spotCvd: snapshot.spot.cvdCumulative,
      futuresCvd: snapshot.futures.cvdCumulative,
      openInterest: snapshot.futures.openInterest,
      fundingRate: snapshot.futures.fundingRate,
      volume: snapshot.futures.volume,
    });

    ctx.logger.info({ symbol, timeframe, signalType: signal.signalType, severity: signal.severity, confidence: signal.confidence }, 'signal fired');

    await dispatchAlert(ctx, signal, signalId, health, risk);
  }
}

async function dispatchAlert(
  ctx: WorkerContext,
  signal: Signal,
  signalId: string,
  health: HealthResult,
  risk: RiskResult,
): Promise<void> {
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
  const dbChatIds = dbSubscribers
    .filter((s) => s.symbols.includes(signal.symbol) && minSeverityOk(s.minSeverity))
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
