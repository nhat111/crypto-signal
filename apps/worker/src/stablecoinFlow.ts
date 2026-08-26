import type { Pool } from 'pg';
import type { Logger } from '@crypto-signal/shared';
import { DefiLlamaStablecoinSource } from '@crypto-signal/market-data';
import { upsertStablecoinSupply } from '@crypto-signal/db';

export interface StablecoinFlowDeps {
  pool: Pool;
  logger: Logger;
}

/**
 * Refreshes the daily stablecoin supply series.
 *
 * Runs on its own timer, wrapped in its own try/catch, and touches nothing
 * the Binance pipeline depends on — DefiLlama being down must never affect
 * candle collection or signal generation. The data is daily, so this only
 * needs to run a few times a day; the extra passes exist to catch the day
 * rolling over and DefiLlama restating recent days, not to gain freshness.
 */
export async function runStablecoinFlowCycle(deps: StablecoinFlowDeps): Promise<void> {
  const { pool, logger } = deps;
  const source = new DefiLlamaStablecoinSource({ logger });

  const points = await source.fetchSupplyHistory();
  if (points.length === 0) {
    logger.warn('stablecoin supply fetch returned no usable points');
    return;
  }

  // Only the recent tail is ever read (getRecentStablecoinSupply defaults to
  // 45 days); writing years of history on every pass would be wasted work.
  const recent = points.slice(-120);
  const written = await upsertStablecoinSupply(pool, recent);

  logger.info(
    { fetched: points.length, written, latestDay: points[points.length - 1]?.day },
    'stablecoin supply refreshed',
  );
}
