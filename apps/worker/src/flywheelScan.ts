import type { Pool } from 'pg';
import type { FlywheelConfig, Logger } from '@crypto-signal/shared';
import { CoinGeckoMarkets, DefiLlamaHoldersRevenueSource } from '@crypto-signal/market-data';
import { readFlywheels, type FlywheelMarket } from '@crypto-signal/indicators';
import { JOB_FLYWHEEL_SCAN, hasFlywheelDay, recordJobFailure, recordJobSuccess, replaceFlywheelDay } from '@crypto-signal/db';

export interface FlywheelScanDeps {
  pool: Pool;
  logger: Logger;
  config: FlywheelConfig;
  coingeckoApiKey?: string;
  /** Injected for tests. */
  source?: Pick<DefiLlamaHoldersRevenueSource, 'fetchHoldersRevenue' | 'fetchTokenDirectory'>;
  markets?: Pick<CoinGeckoMarkets, 'fetchIds'>;
  nowMs?: number;
}

/**
 * The flywheel list for the UTC day: DefiLlama's holders revenue, priced
 * with CoinGecko. Once a day (hourly ticks are a no-op once the day is
 * stored). CoinGecko failing costs the price change and falls back to
 * DefiLlama's market cap; it never costs the day.
 */
export async function runFlywheelCycle(deps: FlywheelScanDeps): Promise<void> {
  const { pool, logger, config } = deps;
  const nowMs = deps.nowMs ?? Date.now();
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (await hasFlywheelDay(pool, day)) return;

  try {
    const source = deps.source ?? new DefiLlamaHoldersRevenueSource({ logger });
    const fees = await source.fetchHoldersRevenue();
    const directory = await source.fetchTokenDirectory();
    const thresholds = { minHoldersRevenue30dUsd: config.minHoldersRevenue30dUsd, maxRows: config.maxRows };

    // First pass only to learn which tokens need a price.
    const unpriced = readFlywheels(fees, directory, new Map(), thresholds);
    const ids = [...new Set(unpriced.map((r) => r.geckoId).filter((id): id is string => Boolean(id)))];
    const markets = new Map<string, FlywheelMarket>();
    try {
      const client = deps.markets ?? new CoinGeckoMarkets({ logger, apiKey: deps.coingeckoApiKey || undefined });
      for (let i = 0; i < ids.length; i += 250) {
        for (const m of await client.fetchIds(ids.slice(i, i + 250))) {
          markets.set(m.id, { marketCapUsd: m.marketCapUsd, change30dPct: m.change30dPct });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'flywheel: CoinGecko prices unavailable, using DefiLlama market caps');
    }

    const rows = readFlywheels(fees, directory, markets, thresholds);
    if (rows.length === 0) {
      await recordJobFailure(pool, JOB_FLYWHEEL_SCAN, new Error(`no flywheel rows from ${fees.length} holders-revenue rows`));
      return;
    }
    await replaceFlywheelDay(pool, day, rows);
    await recordJobSuccess(pool, JOB_FLYWHEEL_SCAN);
    logger.info({ day, feeRows: fees.length, rows: rows.length, priced: markets.size }, 'flywheel list stored');
  } catch (err) {
    await recordJobFailure(pool, JOB_FLYWHEEL_SCAN, err).catch(() => {});
    throw err;
  }
}
