import type { Candle, DataQuality, SymbolId, Timeframe } from '@crypto-signal/shared';
import type { FundingBias } from './funding.js';
import type { VolumeAnomalyLevel } from './volumeAnomaly.js';
import type { LiquidationBucket } from './liquidationAnomaly.js';
import type { OiPriceInterpretation } from './openInterest.js';

/**
 * The full, deterministic indicator bundle for one (symbol, timeframe) at
 * one closed-candle instant. This is the single contract between the
 * indicator layer and the signal-engine / health-engine layers — nothing
 * downstream re-derives a number from raw candles, everything reads it from
 * here (rule: "Tách indicator khỏi signal engine", still one clean seam).
 */
export interface MarketSnapshot {
  symbol: SymbolId;
  timeframe: Timeframe;
  timestamp: number;
  price: {
    open: number;
    high: number;
    low: number;
    close: number;
    changePct: number;
    atrPct: number;
    structureScore: number;
  };
  spot: {
    candle: Candle;
    volume: number;
    cvdDelta: number;
    cvdSkewRatio: number;
    cvdCumulative: number;
    volumeRatio: number;
    volumeAnomaly: VolumeAnomalyLevel;
  };
  futures: {
    candle: Candle;
    volume: number;
    cvdDelta: number;
    cvdSkewRatio: number;
    cvdCumulative: number;
    volumeRatio: number;
    volumeAnomaly: VolumeAnomalyLevel;
    openInterest: number;
    oiChangePct: number;
    oiVelocityPctPerHour: number;
    oiPriceInterpretation: OiPriceInterpretation;
    fundingRate: number;
    fundingRatePct: number;
    fundingBias: FundingBias;
    basisAbsolute: number;
    basisPct: number;
    liquidation: LiquidationBucket;
    liquidationAnomalyRatio: number;
    liquidationSpike: boolean;
  };
  dataQuality: DataQuality;
}
