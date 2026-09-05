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
export interface SpotSnapshot {
  candle: Candle;
  volume: number;
  cvdDelta: number;
  cvdSkewRatio: number;
  cvdCumulative: number;
  volumeRatio: number;
  volumeAnomaly: VolumeAnomalyLevel;
}

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
    /**
     * Volatility before this candle, so a move can be measured against
     * what was normal rather than against itself. Null when there is not
     * enough history to have a baseline — never 0, which would make every
     * move look infinitely abnormal.
     */
    baselineAtrPct: number | null;
    structureScore: number;
  };
  /**
   * Null for symbols that only trade on Binance Futures (no Spot listing —
   * e.g. HYPEUSDT as of writing). Every spot-dependent computation (Spot
   * CVD, spot-vs-futures divergence signals, Health Score's spot
   * confirmation component, basis) is unavailable for those symbols and
   * must be treated as "no data", never approximated — see
   * ASSUMPTIONS.md §15 and packages/signal-engine's spot-null guards.
   */
  spot: SpotSnapshot | null;
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
