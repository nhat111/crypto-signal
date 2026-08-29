import type { Pool } from 'pg';
import type { Logger } from '@crypto-signal/shared';
import { DefiLlamaStablecoinSource } from '@crypto-signal/market-data';
import { JOB_STABLECOIN_FLOW, recordJobFailure, recordJobSuccess, upsertStablecoinSupply } from '@crypto-signal/db';

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

  // The outcome is recorded here rather than left to the caller's catch,
  // because the failure that matters most is the silent one: DefiLlama's
  // response shape was never verifiable from the build environment, so a
  // renamed field would throw on every pass while /api/flow kept returning
  // the same null it returns before the first refresh. Recording the
  // attempt is what lets the two be told apart.
  try {
    const source = new DefiLlamaStablecoinSource({ logger });
    const points = await source.fetchSupplyHistory();

    if (points.length === 0) {
      // Reached upstream and understood the response, but it carried
      // nothing usable — a failure as far as the reader is concerned, so it
      // is recorded as one rather than passed off as a successful refresh.
      await recordJobFailure(pool, JOB_STABLECOIN_FLOW, new Error('upstream returned no usable points'));
      logger.warn('stablecoin supply fetch returned no usable points');
      return;
    }

    // Only the recent tail is ever read (getRecentStablecoinSupply defaults
    // to 45 days); writing years of history on every pass would be wasted
    // work.
    const recent = points.slice(-120);
    const written = await upsertStablecoinSupply(pool, recent);
    await recordJobSuccess(pool, JOB_STABLECOIN_FLOW);

    logger.info(
      { fetched: points.length, written, latestDay: points[points.length - 1]?.day },
      'stablecoin supply refreshed',
    );
  } catch (err) {
    await recordJobFailure(pool, JOB_STABLECOIN_FLOW, err).catch(() => {
      // Recording the failure must not mask the failure itself.
    });
    throw err;
  }
}
