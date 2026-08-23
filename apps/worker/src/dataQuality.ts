import type { DataQuality, DataQualityIssue, SymbolId, Timeframe } from '@crypto-signal/shared';
import { clamp } from '@crypto-signal/shared';

export interface DataQualityInputs {
  spotWsHealthy: boolean;
  futuresWsHealthy: boolean;
  spotGapCandles: number;
  futuresGapCandles: number;
  openInterestStale: boolean;
  fundingStale: boolean;
  liquidationBaselineReady: boolean;
}

/**
 * Turns connection/staleness/gap facts into a single 0-100 score that
 * directly discounts signal confidence (spec §29 "Nếu data thiếu:
 * DATA_QUALITY = LOW. Không được tạo signal confidence cao từ dữ liệu
 * thiếu.") — see how this feeds ConfidenceInputs.dataQualityScore in
 * packages/signal-engine.
 */
export function assessDataQuality(
  symbol: SymbolId,
  timeframe: Timeframe,
  inputs: DataQualityInputs,
  evaluatedAt: number,
): DataQuality {
  const issues: DataQualityIssue[] = [];
  let score = 100;

  if (!inputs.spotWsHealthy || !inputs.futuresWsHealthy) {
    issues.push('ws_disconnected');
    score -= 40;
  }
  if (inputs.spotGapCandles > 0 || inputs.futuresGapCandles > 0) {
    issues.push('candle_gap');
    score -= Math.min(30, 10 * (inputs.spotGapCandles + inputs.futuresGapCandles));
  }
  if (inputs.openInterestStale) {
    issues.push('stale_open_interest');
    score -= 15;
  }
  if (inputs.fundingStale) {
    issues.push('stale_funding');
    score -= 10;
  }
  if (!inputs.liquidationBaselineReady) {
    issues.push('stale_liquidation_baseline');
    score -= 10;
  }

  return {
    symbol,
    market: 'combined',
    timeframe,
    score: Math.round(clamp(score, 0, 100)),
    issues,
    evaluatedAt,
  };
}
