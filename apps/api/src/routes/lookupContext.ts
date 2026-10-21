import type { Pool } from 'pg';
import {
  getLatestCoinScan,
  getLatestFlywheel,
  getLatestSectors,
  type CoinScanRow,
  type FlywheelStoredRow,
  type SectorRow,
} from '@crypto-signal/db';

/**
 * What the app already knows about a looked-up coin, from data the worker
 * stored: the coin scan's flow read (spot or leverage), the sectors it
 * leads, and its flywheel. A lookup used to print only its chart read,
 * while the answer to "is this move real money" sat in another table.
 *
 * Read from the database only, so it adds no outside request to a route a
 * person can hit repeatedly, and a failure here never costs the lookup.
 */
export interface LookupContext {
  /** The coin's row in the latest scan, or null when it is outside the scanned top coins. */
  coinScan: CoinScanRow | null;
  /** The scan's day and size, so "not in the scan" can say what scan. */
  coinScanDay: string | null;
  coinScanSize: number;
  /** Sectors whose top three over 7 days include this coin. */
  sectors: Array<{ categoryId: string; name: string; label: SectorRow['label']; rank: number; change7dPct: number }>;
  flywheel: Pick<
    FlywheelStoredRow,
    'name' | 'symbol' | 'holdersRevenue30dUsd' | 'holdersRevenueChangePct' | 'yieldPct' | 'priceChange30dPct' | 'mechanism'
  > | null;
}

/** The quotes Lookup tries, longest first so "FDUSD" is not read as "…USD". */
const QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'BTC'];

/** INJUSDT → INJ. The scan, sectors and flywheel all key coins by their base ticker. */
export function baseAsset(symbol: string): string {
  const upper = symbol.toUpperCase();
  for (const q of QUOTES) {
    if (upper.endsWith(q) && upper.length > q.length) return upper.slice(0, -q.length);
  }
  return upper;
}

export function buildLookupContext(
  symbol: string,
  scan: { day: string | null; rows: CoinScanRow[] },
  sectors: SectorRow[],
  flywheel: FlywheelStoredRow[],
): LookupContext {
  const base = baseAsset(symbol);
  const coinScan = scan.rows.find((r) => baseAsset(r.symbol) === base) ?? null;

  const leading = sectors.flatMap((s) => {
    const rank = s.leaders.findIndex((l) => l.symbol.toUpperCase() === base);
    return rank === -1
      ? []
      : [{ categoryId: s.categoryId, name: s.name, label: s.label, rank: rank + 1, change7dPct: (s.leaders[rank] as SectorRow['leaders'][number]).change7dPct }];
  });

  // By ticker: DefiLlama's symbol is the token's. Two projects sharing a
  // ticker is possible; the largest payout wins, since that is the one a
  // reader of a listed exchange pair most likely means.
  const fw = flywheel.filter((r) => r.symbol?.toUpperCase() === base).sort((a, b) => b.holdersRevenue30dUsd - a.holdersRevenue30dUsd)[0];

  return {
    coinScan,
    coinScanDay: scan.day,
    coinScanSize: scan.rows.length,
    sectors: leading,
    flywheel: fw
      ? {
          name: fw.name,
          symbol: fw.symbol,
          holdersRevenue30dUsd: fw.holdersRevenue30dUsd,
          holdersRevenueChangePct: fw.holdersRevenueChangePct,
          yieldPct: fw.yieldPct,
          priceChange30dPct: fw.priceChange30dPct,
          mechanism: fw.mechanism,
        }
      : null,
  };
}

export async function loadLookupContext(pool: Pool, symbol: string): Promise<LookupContext> {
  const [scan, sectors, flywheel] = await Promise.all([getLatestCoinScan(pool), getLatestSectors(pool), getLatestFlywheel(pool, 200)]);
  return buildLookupContext(symbol, scan, sectors.sectors, flywheel.rows);
}
