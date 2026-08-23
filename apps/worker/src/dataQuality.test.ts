import { describe, expect, it } from 'vitest';
import { assessDataQuality } from './dataQuality.js';

const healthyInputs = {
  spotWsHealthy: true,
  futuresWsHealthy: true,
  spotGapCandles: 0,
  futuresGapCandles: 0,
  openInterestStale: false,
  fundingStale: false,
  liquidationBaselineReady: true,
};

describe('assessDataQuality (spec §29 "Nếu data thiếu: DATA_QUALITY = LOW")', () => {
  it('scores 100 with no issues', () => {
    const result = assessDataQuality('BTCUSDT', '15m', healthyInputs, 0);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it('penalizes a disconnected websocket heavily', () => {
    const result = assessDataQuality('BTCUSDT', '15m', { ...healthyInputs, spotWsHealthy: false }, 0);
    expect(result.score).toBeLessThan(70);
    expect(result.issues).toContain('ws_disconnected');
  });

  it('penalizes candle gaps proportionally to how many candles were missed', () => {
    const oneGap = assessDataQuality('BTCUSDT', '15m', { ...healthyInputs, spotGapCandles: 1 }, 0);
    const threeGap = assessDataQuality('BTCUSDT', '15m', { ...healthyInputs, spotGapCandles: 3 }, 0);
    expect(oneGap.issues).toContain('candle_gap');
    expect(threeGap.score).toBeLessThanOrEqual(oneGap.score);
  });

  it('never goes below 0 or above 100 even when everything is wrong', () => {
    const result = assessDataQuality(
      'BTCUSDT',
      '15m',
      {
        spotWsHealthy: false,
        futuresWsHealthy: false,
        spotGapCandles: 10,
        futuresGapCandles: 10,
        openInterestStale: true,
        fundingStale: true,
        liquidationBaselineReady: false,
      },
      0,
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
