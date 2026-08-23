import type { Candle, DataQuality, LiquidationEvent, OpenInterestPoint, SymbolId, Thresholds, Timeframe } from '@crypto-signal/shared';
import { accumulateCvd, computeCandleDelta, computeSkewRatio } from './cvd.js';
import { computeOiChange, interpretOiVsPrice } from './openInterest.js';
import { classifyFunding, fundingRateToPct } from './funding.js';
import { computeBasis } from './basis.js';
import { classifyVolumeAnomaly, computeVolumeRatio, rollingAverage } from './volumeAnomaly.js';
import { computeAtr, computeAtrPct, computePriceStructureScore, computeReturnPct, computeTrueRange } from './volatility.js';
import { aggregateLiquidations, computeLiquidationAnomalyRatio, isLiquidationSpike } from './liquidationAnomaly.js';
import type { MarketSnapshot } from './types.js';

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

export function computeMarketSnapshot(input: ComputeSnapshotInput): MarketSnapshot {
  const { spotCandle, futuresCandle, thresholds } = input;

  const spotCvdDelta = computeCandleDelta(spotCandle);
  const spotCvdSkew = computeSkewRatio(spotCandle);
  const spotCvdCumulative = accumulateCvd(input.previousSpotCumulativeCvd, spotCandle);
  const spotVolumeAvg = rollingAverage(input.spotVolumeHistory);
  const spotVolumeRatio = computeVolumeRatio(spotCandle.volume, spotVolumeAvg);

  const futuresCvdDelta = computeCandleDelta(futuresCandle);
  const futuresCvdSkew = computeSkewRatio(futuresCandle);
  const futuresCvdCumulative = accumulateCvd(input.previousFuturesCumulativeCvd, futuresCandle);
  const futuresVolumeAvg = rollingAverage(input.futuresVolumeHistory);
  const futuresVolumeRatio = computeVolumeRatio(futuresCandle.volume, futuresVolumeAvg);

  const oiChange = computeOiChange(input.currentOpenInterest, input.previousOpenInterest, input.timeframe);
  const priceChangePct = computeReturnPct(futuresCandle.open, futuresCandle.close);
  const oiInterpretation = interpretOiVsPrice(priceChangePct, oiChange.changePct, thresholds.priceChangePct, thresholds.oiChangePct);

  const fundingBias = classifyFunding(input.fundingRateFraction, thresholds);
  const basis = computeBasis(futuresCandle.close, spotCandle.close);

  const trueRange = computeTrueRange(futuresCandle, input.previousFuturesClose);
  const atr = computeAtr([...input.recentTrueRanges, trueRange]);
  const atrPct = computeAtrPct(atr, futuresCandle.close);

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
      structureScore: computePriceStructureScore(atrPct),
    },
    spot: {
      candle: spotCandle,
      volume: spotCandle.volume,
      cvdDelta: spotCvdDelta,
      cvdSkewRatio: spotCvdSkew,
      cvdCumulative: spotCvdCumulative,
      volumeRatio: spotVolumeRatio,
      volumeAnomaly: classifyVolumeAnomaly(spotVolumeRatio, thresholds),
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
