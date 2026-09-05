import type { Candle, DataQuality, LiquidationEvent, OpenInterestPoint, SymbolId, Thresholds, Timeframe } from '@crypto-signal/shared';
import { accumulateCvd, computeCandleDelta, computeSkewRatio } from './cvd.js';
import { computeOiChange, interpretOiVsPrice } from './openInterest.js';
import { classifyFunding, fundingRateToPct } from './funding.js';
import { computeBasis } from './basis.js';
import { classifyVolumeAnomaly, computeVolumeRatio, rollingAverage } from './volumeAnomaly.js';
import { computeAtr, computeAtrPct, computeBaselineAtrPct, computePriceStructureScore, computeReturnPct, computeTrueRange } from './volatility.js';
import { aggregateLiquidations, computeLiquidationAnomalyRatio, isLiquidationSpike } from './liquidationAnomaly.js';
import type { MarketSnapshot, SpotSnapshot } from './types.js';

interface FuturesOnlyInput {
  symbol: SymbolId;
  timeframe: Timeframe;
  futuresCandle: Candle;
  previousFuturesCumulativeCvd: number;
  /** Recent volumes, most recent last, NOT including the current candle. */
  futuresVolumeHistory: number[];
  previousOpenInterest: OpenInterestPoint | undefined;
  currentOpenInterest: OpenInterestPoint;
  fundingRateFraction: number;
  liquidationEventsInWindow: LiquidationEvent[];
  rollingLiquidation24hUsd: number;
  previousFuturesClose: number | undefined;
  /** Recent true ranges, NOT including the current candle. */
  recentTrueRanges: number[];
  /** Futures close matched to this candle's spot counterpart, when one exists — null for futures-only symbols (spec §11 basis needs both legs). */
  spotCloseForBasis: number | null;
  dataQuality: DataQuality;
  thresholds: Thresholds;
}

function buildSnapshotCore(input: FuturesOnlyInput): Omit<MarketSnapshot, 'spot'> {
  const { futuresCandle, thresholds } = input;

  const futuresCvdDelta = computeCandleDelta(futuresCandle);
  const futuresCvdSkew = computeSkewRatio(futuresCandle);
  const futuresCvdCumulative = accumulateCvd(input.previousFuturesCumulativeCvd, futuresCandle);
  const futuresVolumeAvg = rollingAverage(input.futuresVolumeHistory);
  const futuresVolumeRatio = computeVolumeRatio(futuresCandle.volume, futuresVolumeAvg);

  const oiChange = computeOiChange(input.currentOpenInterest, input.previousOpenInterest, input.timeframe);
  const priceChangePct = computeReturnPct(futuresCandle.open, futuresCandle.close);
  const oiInterpretation = interpretOiVsPrice(priceChangePct, oiChange.changePct, thresholds.priceChangePct, thresholds.oiChangePct);

  const fundingBias = classifyFunding(input.fundingRateFraction, thresholds);
  // No spot leg (futures-only symbol) => basis is undefined, not zero-by-coincidence — reported as 0/neutral and flagged via dataQuality.issues rather than guessed (ASSUMPTIONS.md §15).
  const basis = input.spotCloseForBasis !== null ? computeBasis(futuresCandle.close, input.spotCloseForBasis) : { absolute: 0, pct: 0 };

  const trueRange = computeTrueRange(futuresCandle, input.previousFuturesClose);
  const atr = computeAtr([...input.recentTrueRanges, trueRange]);
  const atrPct = computeAtrPct(atr, futuresCandle.close);
  // Measured off the open, the same base `changePct` uses, so the ratio of
  // the two is a like-for-like comparison.
  const baselineAtrPct = computeBaselineAtrPct(input.recentTrueRanges, futuresCandle.open);

  const liquidationBucket = aggregateLiquidations(input.liquidationEventsInWindow);
  const liquidationAnomalyRatio = computeLiquidationAnomalyRatio(liquidationBucket.totalUsd, input.rollingLiquidation24hUsd);

  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    timestamp: futuresCandle.closeTime,
    price: {
      open: futuresCandle.open,
      high: futuresCandle.high,
      low: futuresCandle.low,
      close: futuresCandle.close,
      changePct: priceChangePct,
      atrPct,
      baselineAtrPct,
      structureScore: computePriceStructureScore(atrPct),
    },
    futures: {
      candle: futuresCandle,
      volume: futuresCandle.volume,
      cvdDelta: futuresCvdDelta,
      cvdSkewRatio: futuresCvdSkew,
      cvdCumulative: futuresCvdCumulative,
      volumeRatio: futuresVolumeRatio,
      volumeAnomaly: classifyVolumeAnomaly(futuresVolumeRatio, thresholds),
      openInterest: input.currentOpenInterest.sumOpenInterest,
      oiChangePct: oiChange.changePct,
      oiVelocityPctPerHour: oiChange.velocityPctPerHour,
      oiPriceInterpretation: oiInterpretation,
      fundingRate: input.fundingRateFraction,
      fundingRatePct: fundingRateToPct(input.fundingRateFraction),
      fundingBias,
      basisAbsolute: basis.absolute,
      basisPct: basis.pct,
      liquidation: liquidationBucket,
      liquidationAnomalyRatio,
      liquidationSpike: isLiquidationSpike(liquidationAnomalyRatio, thresholds),
    },
    dataQuality: input.dataQuality,
  };
}

export interface ComputeSnapshotInput {
  symbol: SymbolId;
  timeframe: Timeframe;
  spotCandle: Candle;
  futuresCandle: Candle;
  previousSpotCumulativeCvd: number;
  previousFuturesCumulativeCvd: number;
  /** Recent volumes, most recent last, NOT including the current candle. */
  spotVolumeHistory: number[];
  futuresVolumeHistory: number[];
  previousOpenInterest: OpenInterestPoint | undefined;
  currentOpenInterest: OpenInterestPoint;
  fundingRateFraction: number;
  liquidationEventsInWindow: LiquidationEvent[];
  rollingLiquidation24hUsd: number;
  previousFuturesClose: number | undefined;
  /** Recent true ranges, NOT including the current candle. */
  recentTrueRanges: number[];
  dataQuality: DataQuality;
  thresholds: Thresholds;
}

/** For symbols with both a Binance Spot and Futures listing (the normal case: BTCUSDT, ETHUSDT, SOLUSDT). */
export function computeMarketSnapshot(input: ComputeSnapshotInput): MarketSnapshot {
  const spotCvdDelta = computeCandleDelta(input.spotCandle);
  const spotCvdSkew = computeSkewRatio(input.spotCandle);
  const spotCvdCumulative = accumulateCvd(input.previousSpotCumulativeCvd, input.spotCandle);
  const spotVolumeAvg = rollingAverage(input.spotVolumeHistory);
  const spotVolumeRatio = computeVolumeRatio(input.spotCandle.volume, spotVolumeAvg);

  const spot: SpotSnapshot = {
    candle: input.spotCandle,
    volume: input.spotCandle.volume,
    cvdDelta: spotCvdDelta,
    cvdSkewRatio: spotCvdSkew,
    cvdCumulative: spotCvdCumulative,
    volumeRatio: spotVolumeRatio,
    volumeAnomaly: classifyVolumeAnomaly(spotVolumeRatio, input.thresholds),
  };

  const core = buildSnapshotCore({ ...input, spotCloseForBasis: input.spotCandle.close });
  return { ...core, spot };
}

export interface ComputeFuturesOnlySnapshotInput {
  symbol: SymbolId;
  timeframe: Timeframe;
  futuresCandle: Candle;
  previousFuturesCumulativeCvd: number;
  futuresVolumeHistory: number[];
  previousOpenInterest: OpenInterestPoint | undefined;
  currentOpenInterest: OpenInterestPoint;
  fundingRateFraction: number;
  liquidationEventsInWindow: LiquidationEvent[];
  rollingLiquidation24hUsd: number;
  previousFuturesClose: number | undefined;
  recentTrueRanges: number[];
  dataQuality: DataQuality;
  thresholds: Thresholds;
}

/**
 * For symbols with a Binance Futures listing but no Spot listing (e.g.
 * HYPEUSDT). `spot` is null throughout — see MarketSnapshot's doc comment
 * and ASSUMPTIONS.md §15 for exactly what becomes unavailable downstream.
 */
export function computeFuturesOnlySnapshot(input: ComputeFuturesOnlySnapshotInput): MarketSnapshot {
  const core = buildSnapshotCore({ ...input, spotCloseForBasis: null });
  return { ...core, spot: null };
}
