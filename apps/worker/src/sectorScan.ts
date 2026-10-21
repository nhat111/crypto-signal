import type { Pool } from 'pg';
import type { Logger, SectorScanConfig } from '@crypto-signal/shared';
import { CoinGeckoMarkets } from '@crypto-signal/market-data';
import { SECTOR_NAMES_VI, readSector } from '@crypto-signal/indicators';
import { JOB_SECTOR_SCAN, getStoredSectorIds, pruneSectorFlywheel, recordJobFailure, recordJobSuccess, upsertSectorRead } from '@crypto-signal/db';

export interface SectorScanDeps {
  pool: Pool;
  logger: Logger;
  config: SectorScanConfig;
  /** Injected for tests. */
  markets?: Pick<CoinGeckoMarkets, 'fetchCategory' | 'fetchIds'>;
  nowMs?: number;
  /** Gap between CoinGecko calls; the keyless limit is a few a minute per IP. */
  pauseMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sectorName(id: string): string {
  return SECTOR_NAMES_VI[id] ?? id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Reads each configured CoinGecko category against BTC for the UTC day.
 *
 * Hourly and incremental: categories already stored today are skipped, so
 * a run cut short by CoinGecko's rate limit is finished by the next one
 * instead of starting over, and a fully stored day costs no request at
 * all. BTC is fetched first on every run that has work; if even that one
 * call fails the run stops there rather than spending twenty more on an
 * API that is refusing us.
 */
export async function runSectorScanCycle(deps: SectorScanDeps): Promise<void> {
  const { pool, logger, config } = deps;
  const nowMs = deps.nowMs ?? Date.now();
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const stored = await getStoredSectorIds(pool, day);
  const missing = config.categories.filter((id) => !stored.has(id));
  if (missing.length === 0) return;

  const markets = deps.markets ?? new CoinGeckoMarkets({ logger, apiKey: config.coingeckoApiKey || undefined });
  const pauseMs = deps.pauseMs ?? (config.coingeckoApiKey ? 2_500 : 6_000);

  try {
    const [btc] = await markets.fetchIds(['bitcoin']);
    if (!btc || btc.change7dPct === null || btc.change30dPct === null) {
      throw new Error('CoinGecko returned no 7d/30d change for bitcoin');
    }
    const btcChange = { change7dPct: btc.change7dPct, change30dPct: btc.change30dPct };

    await sleep(pauseMs);
    let stablecoinIds = new Set<string>();
    try {
      stablecoinIds = new Set((await markets.fetchCategory('stablecoins', 100)).map((c) => c.id));
    } catch (err) {
      // Without the list a category holding USDT reads a little flatter;
      // not worth losing the day over.
      logger.warn({ err }, 'sector scan: stablecoin list unavailable');
    }

    let written = 0;
    let failed = 0;
    let lastError: unknown = null;
    for (const id of missing) {
      await sleep(pauseMs);
      try {
        const coins = await markets.fetchCategory(id, config.coinsPerCategory);
        const read = readSector(id, sectorName(id), coins, btcChange, stablecoinIds);
        if (read) {
          await upsertSectorRead(pool, day, read);
          written += 1;
        } else {
          logger.warn({ id, coins: coins.length }, 'sector scan: too few coins with both returns');
        }
      } catch (err) {
        failed += 1;
        lastError = err;
        logger.warn({ err, id }, 'sector scan: category failed');
      }
    }
    await pruneSectorFlywheel(pool, day);

    if (written === 0 && failed > 0) {
      await recordJobFailure(pool, JOB_SECTOR_SCAN, lastError);
    } else {
      await recordJobSuccess(pool, JOB_SECTOR_SCAN);
    }
    logger.info({ day, written, failed, alreadyStored: stored.size }, 'sector scan stored');
  } catch (err) {
    await recordJobFailure(pool, JOB_SECTOR_SCAN, err).catch(() => {});
    throw err;
  }
}
