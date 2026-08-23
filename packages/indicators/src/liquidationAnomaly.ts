import type { LiquidationEvent, Thresholds } from '@crypto-signal/shared';

export interface LiquidationBucket {
  /** side === 'SELL' force-closes a LONG position, so this is the long-liquidation notional. */
  longLiquidationUsd: number;
  /** side === 'BUY' force-closes a SHORT position. */
  shortLiquidationUsd: number;
  totalUsd: number;
  count: number;
}

export function aggregateLiquidations(events: LiquidationEvent[]): LiquidationBucket {
  let longLiquidationUsd = 0;
  let shortLiquidationUsd = 0;
  for (const event of events) {
    if (event.side === 'SELL') longLiquidationUsd += event.quoteQuantity;
    else shortLiquidationUsd += event.quoteQuantity;
  }
  return {
    longLiquidationUsd,
    shortLiquidationUsd,
    totalUsd: longLiquidationUsd + shortLiquidationUsd,
    count: events.length,
  };
}

/** current_liquidation / rolling_average_24h (spec §10). Caller is responsible for only supplying a genuine 24h average — see ASSUMPTIONS.md §6 for why this can't be backfilled on a cold start. */
export function computeLiquidationAnomalyRatio(currentTotalUsd: number, rollingAverage24hUsd: number): number {
  if (rollingAverage24hUsd <= 0) return 0;
  return currentTotalUsd / rollingAverage24hUsd;
}

export function isLiquidationSpike(ratio: number, thresholds: Thresholds): boolean {
  return ratio >= thresholds.liquidationSpikeMult;
}
