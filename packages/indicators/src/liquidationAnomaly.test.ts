import { describe, expect, it } from 'vitest';
import type { LiquidationEvent, Thresholds } from '@crypto-signal/shared';
import { aggregateLiquidations, computeLiquidationAnomalyRatio, isLiquidationSpike } from './liquidationAnomaly.js';

const thresholds: Thresholds = {
  priceChangePct: 0.3,
  cvdSkewRatio: 0.15,
  oiChangePct: 2,
  oiStrongChangePct: 5,
  fundingElevatedPct: 0.01,
  fundingExtremePct: 0.03,
  volumeElevatedMult: 1.5,
  volumeAbnormalMult: 2,
  volumeExtremeMult: 3,
  liquidationSpikeMult: 3,
  basisElevatedPct: 0.1,
  priceShockAtrMult: 3,
  priceShockMinMovePct: 1,
};

function event(side: 'BUY' | 'SELL', quoteQuantity: number): LiquidationEvent {
  return { symbol: 'BTCUSDT', side, orderType: 'LIMIT', quantity: 1, price: 100, averagePrice: 100, orderStatus: 'FILLED', orderTradeTime: 0, quoteQuantity };
}

describe('liquidation aggregation', () => {
  it('a SELL order force-closes a LONG — attributed to longLiquidationUsd', () => {
    const bucket = aggregateLiquidations([event('SELL', 1000)]);
    expect(bucket.longLiquidationUsd).toBe(1000);
    expect(bucket.shortLiquidationUsd).toBe(0);
  });

  it('a BUY order force-closes a SHORT — attributed to shortLiquidationUsd', () => {
    const bucket = aggregateLiquidations([event('BUY', 500)]);
    expect(bucket.shortLiquidationUsd).toBe(500);
    expect(bucket.longLiquidationUsd).toBe(0);
  });

  it('spec §10 ratio = current / rolling_average_24h', () => {
    expect(computeLiquidationAnomalyRatio(300, 100)).toBe(3);
    expect(computeLiquidationAnomalyRatio(100, 0)).toBe(0); // no baseline yet, never divide by zero into a fake spike
  });

  it('flags a spike only at/above the configured multiplier', () => {
    expect(isLiquidationSpike(2.9, thresholds)).toBe(false);
    expect(isLiquidationSpike(3, thresholds)).toBe(true);
  });
});
