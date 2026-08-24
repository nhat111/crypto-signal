import { describe, expect, it } from 'vitest';
import { assessDataQuality } from './dataQuality.js';

const healthyInputs = {
  futuresWsHealthy: true,
  futuresGapCandles: 0,
  openInterestStale: false,
  fundingStale: false,
  liquidationBaselineReady: true,
  spot: { wsHealthy: true, gapCandles: 0 },
};

describe('assessDataQuality (spec §29 "Nếu data thiếu: DATA_QUALITY = LOW")', () => {
  it('scores 100 with no issues', () => {
    const result = assessDataQuality('BTCUSDT', '15m', healthyInputs, 0);
    expect(result.score).toBe(100);
    expect(result.issues).toHaveLength(0);
  });

  it('penalizes a disconnected websocket heavily', () => {
    const result = assessDataQuality('BTCUSDT', '15m', { ...healthyInputs, spot: { wsHealthy: false, gapCandles: 0 } }, 0);
    expect(result.score).toBeLessThan(70);
    expect(result.issues).toContain('ws_disconnected');
  });

  it('penalizes candle gaps proportionally to how many candles were missed', () => {
    const oneGap = assessDataQuality('BTCUSDT', '15m', { ...healthyInputs, spot: { wsHealthy: true, gapCandles: 1 } }, 0);
    const threeGap = assessDataQuality('BTCUSDT', '15m', { ...healthyInputs, spot: { wsHealthy: true, gapCandles: 3 } }, 0);
    expect(oneGap.issues).toContain('candle_gap');
    expect(threeGap.score).toBeLessThanOrEqual(oneGap.score);
  });

  it('never goes below 0 or above 100 even when everything is wrong', () => {
    const result = assessDataQuality(
      'BTCUSDT',
      '15m',
      {
        futuresWsHealthy: false,
        futuresGapCandles: 10,
        openInterestStale: true,
        fundingStale: true,
        liquidationBaselineReady: false,
        spot: { wsHealthy: false, gapCandles: 10 },
      },
      0,
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('flags no_spot_market for futures-only symbols without penalizing the score', () => {
    const result = assessDataQuality(
      'HYPEUSDT',
      '15m',
      {
        futuresWsHealthy: true,
        futuresGapCandles: 0,
        openInterestStale: false,
        fundingStale: false,
        liquidationBaselineReady: true,
        // no `spot` field at all — this is the futures-only path
      },
      0,
    );
    expect(result.issues).toContain('no_spot_market');
    expect(result.score).toBe(100);
  });
});
