import {
  getLatestCoinScan,
  getOpenTradeSetups,
  JOB_COIN_SETUP_SCAN,
  recordJobFailure,
  recordJobSuccess,
  type CoinScanRow,
  type SetupCohort,
  type SetupContext,
  type TradeSetupRow,
} from '@crypto-signal/db';
import { pickWatchlist, readMarketStructure, type MarketStructure, type OhlcvBar } from '@crypto-signal/indicators';
import { BinanceRestError } from '@crypto-signal/market-data';
import type { WorkerContext } from './context.js';
import { fetchDailyBarsWithFallback, type DailyBarSource } from './dailyBars.js';
import { scanSetups } from './setupScan.js';

const DAY_MS = 86_400_000;
/** Same history as the core symbols' trend read: EMA200 with room for its seed. */
const DAILY_BARS = 400;
/** A scan older than this no longer says which coins are strong today; open setups are still resolved. */
const MAX_SCAN_AGE_DAYS = 3;
/** Between coins, so ~30 coins never burst an exchange's per-IP limit. */
const GAP_MS = 250;

export interface CoinSetupTarget {
  symbol: string;
  cohort: SetupCohort;
  context: SetupContext | null;
  /** False for a coin no longer in a usable scan: its open setups are resolved, nothing new is looked for. */
  detect: boolean;
}

/**
 * Which coins this hour's run reads, and in which cohort.
 *
 * Every scanned coin except the core symbols (the trend cycle has those):
 * the watchlist's setups are alerted, the rest are the baseline. A coin
 * with an open setup that has since left the scan is still read, only to
 * resolve it, so a coin dropping out of the top 30 cannot strand a setup
 * as "open" forever — that would leave only the survivors in the record.
 */
export function planCoinSetupScan(
  scan: { day: string | null; rows: CoinScanRow[] },
  open: Pick<TradeSetupRow, 'symbol' | 'cohort'>[],
  coreSymbols: readonly string[],
  watchlistSize: number,
  now: number,
): CoinSetupTarget[] {
  const fresh = scan.day !== null && now - Date.parse(`${scan.day}T00:00:00Z`) <= (MAX_SCAN_AGE_DAYS + 1) * DAY_MS;
  const rows = fresh ? scan.rows.filter((r) => !coreSymbols.includes(r.symbol)) : [];
  const watchlist = new Set(pickWatchlist(rows, watchlistSize).map((r) => r.symbol));

  const targets: CoinSetupTarget[] = rows.map((r) => ({
    symbol: r.symbol,
    cohort: watchlist.has(r.symbol) ? 'watchlist' : 'scan',
    context: { scanDay: r.day, rs30d: r.rs30d, flow: r.flow },
    detect: true,
  }));
  const reading = new Set(targets.map((t) => t.symbol));
  for (const s of open) {
    if (s.cohort === 'core' || reading.has(s.symbol)) continue;
    reading.add(s.symbol);
    targets.push({ symbol: s.symbol, cohort: s.cohort, context: null, detect: false });
  }
  return targets;
}

interface DailyRead {
  day: number;
  source: DailyBarSource;
  bars: OhlcvBar[];
  structure: MarketStructure | null;
}

/**
 * Daily bars change once a day, and this runs every hour over ~30 coins:
 * reading them once per UTC day keeps the hourly cost to one 4H request
 * per coin, which matters on an IP Binance already rations.
 */
const dailyCache = new Map<string, DailyRead>();

const isRefused = (err: unknown): boolean => err instanceof BinanceRestError && [403, 418, 451].includes(err.status);

/**
 * 4H setups on the scanned coins, hourly. Never alerts the baseline; the
 * watchlist only when SETUP_ALERTS is on. Binance refusing once moves the
 * rest of the run to OKX instead of asking thirty more times; a coin
 * Binance does not list is read from OKX.
 */
export async function runCoinSetupCycle(ctx: WorkerContext, now = Date.now()): Promise<void> {
  if (!ctx.config.coinScan.setups) return;

  const [scan, open] = await Promise.all([getLatestCoinScan(ctx.pool), getOpenTradeSetups(ctx.pool)]);
  const core = [...ctx.config.symbols, ...ctx.config.futuresOnlySymbols];
  const targets = planCoinSetupScan(scan, open, core, ctx.config.coinScan.watchlistSize, now);
  if (targets.length === 0) return;

  const today = Math.floor(now / DAY_MS);
  for (const [symbol, read] of dailyCache) if (read.day !== today) dailyCache.delete(symbol);

  const okx = ctx.okxSpot ?? null;
  let binanceOff = false;
  const refusedHere = (): Error => Object.assign(new Error('Binance refused this server earlier in this run'), { status: 418 });
  const failures: string[] = [];
  let scanned = 0;

  for (const [i, target] of targets.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    try {
      let read = dailyCache.get(target.symbol);
      if (read && read.source === 'binance' && binanceOff) read = undefined;
      if (!read) {
        const { bars, source } = await fetchDailyBarsWithFallback(
          async (s, limit, at) => {
            if (binanceOff) throw refusedHere();
            try {
              return await ctx.spotAdapter.fetchClosedDailyBars(s, limit, at);
            } catch (err) {
              if (isRefused(err)) binanceOff = true;
              // A 400 here is a coin Binance does not list (the scan may come
              // from OKX): unlike a core symbol's typo, OKX is the answer.
              if (err instanceof BinanceRestError && err.status === 400) throw Object.assign(new Error(err.message), { status: 404 });
              throw err;
            }
          },
          okx ? (s, limit, at) => okx.fetchClosedDailyBars(s, limit, at) : null,
          target.symbol,
          DAILY_BARS,
          now,
        );
        read = { day: today, source, bars, structure: readMarketStructure(bars) };
        dailyCache.set(target.symbol, read);
      }
      // Too young for EMA200 (a recent listing): nothing to detect on, and not a failure.
      if (!read.structure) continue;

      const source = read.source;
      const fetch4h =
        source === 'binance' || !okx
          ? (s: string, limit: number, at: number) => ctx.spotAdapter.fetchClosedBars(s, '4h', limit, at)
          : (s: string, limit: number, at: number) => okx.fetchClosedBars(s, '4h', limit, at);
      await scanSetups(ctx, target.symbol, read.bars, read.structure, now, source, fetch4h, {
        cohort: target.cohort,
        context: target.context,
        alert: target.cohort === 'watchlist' && ctx.config.setupAlerts,
        detect: target.detect,
      });
      scanned += 1;
    } catch (err) {
      if (isRefused(err)) binanceOff = true;
      failures.push(`${target.symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.logger.info(
    { scanned, targets: targets.length, watchlist: targets.filter((t) => t.cohort === 'watchlist' && t.detect).map((t) => t.symbol), failures: failures.length },
    'coin setup scan done',
  );
  if (scanned > 0) await recordJobSuccess(ctx.pool, JOB_COIN_SETUP_SCAN);
  else if (failures.length > 0) await recordJobFailure(ctx.pool, JOB_COIN_SETUP_SCAN, new Error(failures.slice(0, 5).join('; ')));
  if (failures.length > 0) ctx.logger.warn({ failures }, 'coin setup scan failed for some coins');
}
