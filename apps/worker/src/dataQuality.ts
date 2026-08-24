import type { DataQuality, DataQualityIssue, SymbolId, Timeframe } from '@crypto-signal/shared';
import { clamp } from '@crypto-signal/shared';

export interface DataQualityInputs {
  futuresWsHealthy: boolean;
  futuresGapCandles: number;
  openInterestStale: boolean;
  fundingStale: boolean;
  liquidationBaselineReady: boolean;
  /**
   * Omit for futures-only symbols (no Binance Spot listing) — this is a
   * structural fact, not a collection problem, so it's recorded as the
   * `no_spot_market` issue without discounting the score (unlike every
   * other issue here, which does represent something actually missing
   * that should have been there).
   */
  spot?: { wsHealthy: boolean; gapCandles: number };
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

  if (inputs.spot) {
    if (!inputs.spot.wsHealthy || !inputs.futuresWsHealthy) {
      issues.push('ws_disconnected');
      score -= 40;
    }
    const gapCandles = inputs.spot.gapCandles + inputs.futuresGapCandles;
    if (gapCandles > 0) {
      issues.push('candle_gap');
      score -= Math.min(30, 10 * gapCandles);
    }
  } else {
    issues.push('no_spot_market');
    if (!inputs.futuresWsHealthy) {
      issues.push('ws_disconnected');
      score -= 40;
    }
    if (inputs.futuresGapCandles > 0) {
      issues.push('candle_gap');
      score -= Math.min(30, 10 * inputs.futuresGapCandles);
    }
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
