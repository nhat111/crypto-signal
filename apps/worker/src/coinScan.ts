import {
  getAllAlertSubscribers,
  getCoinScanForDay,
  getLatestCoinScanDay,
  getTrades,
  JOB_COIN_SCAN,
  recordJobFailure,
  recordJobSuccess,
  saveCoinScan,
  type CoinScanExchange,
  type CoinScanInput,
} from '@crypto-signal/db';
import {
  BENCHMARK_SYMBOL,
  flagThinSpot,
  fundingPer8h,
  isStableLike,
  pickCoinUniverse,
  pickWatchlist,
  readCoin,
  sumDailyOpenInterest,
  type CoinDailyBar,
  type CoinUniverseEntry,
  type OiDay,
  type Ticker24h,
} from '@crypto-signal/indicators';
import { BinanceRestError, type BinanceFuturesAdapter, type BinanceSpotAdapter, type OkxCoinScanData } from '@crypto-signal/market-data';
import type { CoinScanConfig } from '@crypto-signal/shared';
import type { WorkerContext } from './context.js';
import { readCoinFundamentals } from './coinFundamentals.js';
import { coinWatchChanges, formatCoinWatch, watchedCoins } from './coinWatch.js';
import { readMemory } from './memory.js';

const DAY_MS = 86_400_000;
/** 61 closed days: 30-day returns, a 20-day ratio average and a 30-day down-day window, with room for a missing bar. */
const DAILY_BARS = 62;
/** Eight daily OI points make one seven-day change. */
const OI_POINTS = 8;

/**
 * What the scan reads from the exchange. An interface rather than the two
 * adapters directly, so the scan can be tested without a network — and so
 * nothing here can reach for a WebSocket.
 */
export interface CoinScanSource {
  spotTickers(): Promise<Ticker24h[]>;
  futuresTickers(): Promise<Ticker24h[]>;
  dailyBars(symbol: string, now: number): Promise<CoinDailyBar[]>;
  /**
   * Daily OI in coins, oldest first, summed over the scan's exchange and
   * every other venue that covers the window (`sumDailyOpenInterest`).
   * `base` is the spot coin (PEPE for 1000PEPEUSDT). A failure of the
   * scan's own exchange throws; another venue failing only leaves it out.
   */
  dailyOpenInterest(futuresSymbol: string, base: string): Promise<{ coins: number[]; venues: string[] }>;
  /** Funding over the last seven days, scaled to 8h. */
  funding7d(futuresSymbol: string, now: number): Promise<number[]>;
}

/**
 * Another exchange's daily OI, added to the scan's own. Free public
 * endpoints only. Binance is not one: it refuses the production server,
 * and on the days it does answer it is already the scan's own venue.
 */
export interface OiVenue {
  readonly name: string;
  dailyOpenInterest(base: string, points: number): Promise<OiDay[]>;
}

/** OKX as an extra venue, on the days Binance answers and is the scan's own. */
export function okxOiVenue(okx: OkxCoinScanData): OiVenue {
  return { name: 'okx', dailyOpenInterest: (base, points) => okx.dailyOpenInterest(`${base}USDT`, points) };
}

/** Binance lists some perps per 1000 or 1,000,000 coins; its OI is in those units. */
function binanceOiScale(futuresSymbol: string, base: string): number {
  if (futuresSymbol === `1000000${base}USDT`) return 1_000_000;
  if (futuresSymbol === `1000${base}USDT`) return 1000;
  return 1;
}

/**
 * The scan's own venue first (its errors decide whether futures are
 * refused), then the others, each allowed to fail on its own.
 */
async function aggregatedOi(
  primary: { venue: string; read: () => Promise<OiDay[]> },
  extras: OiVenue[],
  base: string,
): Promise<{ coins: number[]; venues: string[] }> {
  const days = await primary.read();
  // A coin with no OI on its own venue has nothing for the others to line up with.
  if (days.length === 0) return { coins: [], venues: [] };
  const others = [];
  for (const venue of extras) {
    const read = await venue.dailyOpenInterest(base, OI_POINTS + 1).catch(() => [] as OiDay[]);
    others.push({ venue: venue.name, days: read });
  }
  return sumDailyOpenInterest({ venue: primary.venue, days }, others, OI_POINTS);
}

export function binanceCoinScanSource(spot: BinanceSpotAdapter, futures: BinanceFuturesAdapter, extraOi: OiVenue[] = []): CoinScanSource {
  return {
    spotTickers: () => spot.fetch24hTickers(),
    futuresTickers: () => futures.fetch24hTickers(),
    dailyBars: (symbol, now) => spot.fetchClosedFlowBars(symbol, '1d', DAILY_BARS, now),
    dailyOpenInterest: (symbol, base) =>
      aggregatedOi(
        {
          venue: 'binance',
          read: async () => (await futures.fetchDailyOpenInterest(symbol, OI_POINTS + 1)).map((p) => ({ time: p.timestamp, coins: p.contracts * binanceOiScale(symbol, base) })),
        },
        extraOi,
        base,
      ),
    funding7d: async (symbol, now) => fundingPer8h(await futures.fetchFundingRateHistory(symbol, { startTime: now - 7 * DAY_MS, limit: 200 })),
  };
}

/**
 * The same reads from OKX, for when Binance refuses this server. Spot,
 * perps and taker split all from OKX, so one stored day never mixes two
 * exchanges' order flow — their taker skews disagree in sign on some coins
 * (BNB, TRX), which is a real difference between venues, not noise.
 */
export function okxCoinScanSource(okx: OkxCoinScanData, extraOi: OiVenue[] = []): CoinScanSource {
  return {
    spotTickers: () => okx.spotTickers(),
    futuresTickers: () => okx.swapTickers(),
    dailyBars: (symbol, now) => okx.dailyFlowBars(symbol, DAILY_BARS, now),
    dailyOpenInterest: (symbol, base) => aggregatedOi({ venue: 'okx', read: () => okx.dailyOpenInterest(symbol, OI_POINTS + 1) }, extraOi, base),
    funding7d: async (symbol, now) => fundingPer8h(await okx.fundingHistory(symbol, now - 7 * DAY_MS)),
  };
}

export interface CoinScanResult {
  /** YYYY-MM-DD of BTC's last closed bar — the day every stored row describes. */
  day: string;
  inputs: CoinScanInput[];
  /** Per-coin problems that did not stop the scan. */
  skipped: string[];
  /** How many coins each venue's OI was summed into: whether the extra venues actually answer. */
  oiVenues: Record<string, number>;
  /** The futures host refused the server at some point, so some or all coins have no OI or funding. */
  futuresUnreadable: boolean;
}

/**
 * Binance refusing this server outright, not one bad request: a ban (418),
 * or a region block (451 "restricted location", 403 from the CDN). Every
 * further request to that market fails the same way.
 */
const isRefused = (err: unknown): boolean => err instanceof BinanceRestError && [403, 418, 451].includes(err.status);
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * One full read of the universe. Sequential on purpose: ~90 requests a day
 * is nothing, and a burst is how a shared free-tier IP gets banned. A ban
 * mid-scan stops the scan — every further request would fail the same way
 * and lengthen it.
 */
export async function scanCoins(source: CoinScanSource, config: CoinScanConfig, now: number): Promise<CoinScanResult> {
  // Futures refused is not the scan refused: every coin still gets its spot
  // read, and says plainly that the leverage half is missing this time.
  let futuresUnreadable = false;
  const [spot, futures] = await Promise.all([
    source.spotTickers(),
    source.futuresTickers().catch((err: unknown) => {
      if (!isRefused(err)) throw err;
      futuresUnreadable = true;
      return [] as Ticker24h[];
    }),
  ]);
  const universe = pickCoinUniverse(spot, futures, config.topN, now);

  const btcEntry = universe.find((u) => u.symbol === BENCHMARK_SYMBOL);
  if (!btcEntry) throw new Error('BTCUSDT missing from the spot tickers — nothing to measure strength against');
  const btcBars = await source.dailyBars(BENCHMARK_SYMBOL, now);
  const lastBtc = btcBars[btcBars.length - 1];
  if (!lastBtc) throw new Error('no closed BTC daily bars');
  const day = new Date(lastBtc.openTime).toISOString().slice(0, 10);

  const inputs: CoinScanInput[] = [];
  const skipped: string[] = [];
  const oiVenues: Record<string, number> = {};
  let futuresBanned = futuresUnreadable;

  for (const entry of universe) {
    try {
      const bars = entry.symbol === BENCHMARK_SYMBOL ? btcBars : await source.dailyBars(entry.symbol, now);
      const last = bars[bars.length - 1];
      if (!last || last.openTime !== lastBtc.openTime) {
        skipped.push(`${entry.symbol}: no closed bar for ${day}`);
        continue;
      }
      if (bars.length < 8) {
        skipped.push(`${entry.symbol}: under a week of history`);
        continue;
      }
      if (isStableLike(bars)) {
        skipped.push(`${entry.symbol}: pegged (30-day range under 2%)`);
        continue;
      }

      const { oi, funding, venues } = futuresBanned ? { oi: null, funding: null, venues: [] } : await readLeverage(source, entry, now).catch((err: unknown) => {
        if (isRefused(err)) futuresBanned = true;
        skipped.push(`${entry.symbol}: futures read failed — ${message(err)}`);
        return { oi: null, funding: null, venues: [] };
      });
      for (const v of venues) oiVenues[v] = (oiVenues[v] ?? 0) + 1;

      const read = readCoin({
        symbol: entry.symbol,
        bars,
        btcBars,
        oiContracts: oi,
        fundingRates: funding,
        spotQuoteVolume24h: entry.spotQuoteVolume24h,
        // Kept even when the leverage read failed: "has a perp, could not
        // read it" and "has no perp" are different unknowns.
        futuresQuoteVolume24h: entry.futuresQuoteVolume24h,
        futuresUnreadable,
        thresholds: config.thresholds,
      });
      if (!read) continue; // unreachable after the length check, kept for the type
      inputs.push({ read, volumeRank: entry.rank, futuresSymbol: entry.futuresSymbol, spotQuoteVolume24h: entry.spotQuoteVolume24h });
    } catch (err) {
      if (isRefused(err)) throw err;
      skipped.push(`${entry.symbol}: ${message(err)}`);
    }
  }

  // Thin spot is judged against the day's other coins, not a fixed ratio:
  // on OKX perps out-trade spot almost everywhere, BTC included.
  const reads = flagThinSpot(inputs.map((i) => i.read));
  return { day, inputs: inputs.map((i, n) => ({ ...i, read: reads[n] ?? i.read })), skipped, oiVenues, futuresUnreadable: futuresBanned };
}

async function readLeverage(
  source: CoinScanSource,
  entry: CoinUniverseEntry,
  now: number,
): Promise<{ oi: number[] | null; funding: number[] | null; venues: string[] }> {
  if (!entry.futuresSymbol) return { oi: null, funding: null, venues: [] };
  const oi = await source.dailyOpenInterest(entry.futuresSymbol, entry.base);
  const funding = await source.funding7d(entry.futuresSymbol, now);
  return { oi: oi.coins, funding, venues: oi.venues };
}

/**
 * Binance first; OKX only when Binance refused the server outright. Any
 * other Binance failure is a bug or a bad answer and is rethrown, not
 * papered over with a second exchange.
 */
export async function scanWithFallback(
  binance: CoinScanSource,
  okx: CoinScanSource | null,
  config: CoinScanConfig,
  now: number,
): Promise<{ result: CoinScanResult; exchange: CoinScanExchange; binanceError: string | null }> {
  let binanceResult: CoinScanResult;
  try {
    binanceResult = await scanCoins(binance, config, now);
  } catch (err) {
    if (!okx || !isRefused(err)) throw err;
    try {
      return { result: await scanCoins(okx, config, now), exchange: 'okx', binanceError: message(err) };
    } catch (okxErr) {
      throw new Error(`${message(err)} — OKX fallback failed too: ${message(okxErr)}`);
    }
  }

  // Binance spot answered but its futures host refused the server. From
  // Render's Singapore IP that is the normal case (fapi answers 451), and
  // it stored whole days with no OI or funding: half the flow labels
  // (leverage_led, short_squeeze, long_unwind…) cannot be reached without
  // them. A day is one exchange, so the fix is the whole day from OKX,
  // not Binance spot with OKX perps glued on. Binance's spot-only day is
  // kept when OKX cannot do better.
  if (binanceResult.futuresUnreadable && okx) {
    try {
      const okxResult = await scanCoins(okx, config, now);
      if (!okxResult.futuresUnreadable && okxResult.inputs.length > 0) {
        return { result: okxResult, exchange: 'okx', binanceError: 'Binance futures refused the server; read the whole day from OKX for OI and funding' };
      }
    } catch {
      // OKX failing is no reason to lose the spot day Binance already gave.
    }
  }
  return { result: binanceResult, exchange: 'binance', binanceError: null };
}

/** The day whose daily bar most recently closed, as YYYY-MM-DD. */
export function lastClosedDay(now: number): string {
  return new Date(Math.floor(now / DAY_MS) * DAY_MS - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Hourly tick, one real scan a day: it runs only when the stored scan is
 * older than the last daily close. A failed day is retried on the next
 * tick rather than waiting for tomorrow; a day that stored with gaps keeps
 * them, and says so in each row's unknowns.
 */
export async function runCoinScanCycle(ctx: WorkerContext, now = Date.now(), source?: CoinScanSource): Promise<void> {
  if (!ctx.config.coinScan.enabled) return;
  if ((await getLatestCoinScanDay(ctx.pool)) === lastClosedDay(now)) return;

  let storedDay: string;
  try {
    const { result, exchange, binanceError } = await scanWithFallback(
      source ?? binanceCoinScanSource(ctx.spotAdapter, ctx.futuresAdapter, [...(ctx.okxCoinScan ? [okxOiVenue(ctx.okxCoinScan)] : []), ...(ctx.oiVenues ?? [])]),
      source ? null : ctx.okxCoinScan ? okxCoinScanSource(ctx.okxCoinScan, ctx.oiVenues ?? []) : null,
      ctx.config.coinScan,
      now,
    );
    if (result.inputs.length === 0) throw new Error(`no coin could be read: ${result.skipped.join('; ')}`);

    // Fundamentals are a second source with its own failures: DefiLlama
    // being down must cost the day its fundamentals, never its scan.
    const bases = result.inputs.map((i) => i.read.symbol.replace(/USDT$/, ''));
    const fundamentals = ctx.defiLlama
      ? await readCoinFundamentals(ctx.defiLlama, bases, ctx.logger).catch((err: unknown) => {
          ctx.logger.warn({ err }, 'coin fundamentals unavailable — scan stored without them');
          return null;
        })
      : null;
    // Sampled right after the biggest parse of the day, so the peak the
    // heartbeat reports includes it rather than missing it between beats.
    ctx.logger.info({ memory: readMemory() }, 'memory after coin fundamentals');
    const inputs = result.inputs.map((i) => ({ ...i, fundamentals: fundamentals?.get(i.read.symbol.replace(/USDT$/, '')) ?? null }));

    await saveCoinScan(ctx.pool, result.day, inputs, exchange);
    storedDay = result.day;
    await recordJobSuccess(ctx.pool, JOB_COIN_SCAN);
    if (binanceError) ctx.logger.warn({ binanceError }, 'coin scan read from OKX — Binance refused the server');
    ctx.logger.info({ day: result.day, exchange, coins: result.inputs.length, skipped: result.skipped, oiVenues: result.oiVenues }, 'coin scan stored');
  } catch (err) {
    await recordJobFailure(ctx.pool, JOB_COIN_SCAN, err).catch(() => undefined);
    throw err;
  }
  // After the job is recorded: a failed send must not mark the scan failed.
  await sendCoinWatch(ctx, storedDay).catch((err: unknown) => ctx.logger.warn({ err }, 'coin watch alert failed'));
}

/** Journal symbols are typed by hand ("bat", "BAT", "BATUSDT"); the scan speaks BATUSDT. Contract addresses pass through and simply never match. */
export function scanSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  return /^[A-Z0-9]{1,12}$/.test(s) && !s.endsWith('USDT') ? `${s}USDT` : /^[A-Z0-9]{1,16}$/.test(s) ? s : raw;
}

/**
 * Tells the alert chats when a coin they hold or watch has turned against
 * holding it (see coinWatch.ts). Runs once per stored day, right after the
 * scan, since the hourly ticks return before reaching here once a day is in.
 */
async function sendCoinWatch(ctx: WorkerContext, day: string): Promise<void> {
  const previousDay = new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  const [today, previous, open, subscribers] = await Promise.all([
    getCoinScanForDay(ctx.pool, day),
    getCoinScanForDay(ctx.pool, previousDay),
    getTrades(ctx.pool, { status: 'open', limit: 500 }),
    getAllAlertSubscribers(ctx.pool),
  ]);
  const chatIds = Array.from(new Set([...ctx.config.telegramAlertChatIds, ...subscribers.map((s) => s.chatId)]));
  if (chatIds.length === 0 || today.length === 0 || previous.length === 0) return;

  // The same ⭐ the /coins page shows: core symbols have their own alerts.
  const exclude = [...ctx.config.symbols, ...ctx.config.futuresOnlySymbols];
  const size = ctx.config.coinScan.watchlistSize;
  const starredBefore = new Set(pickWatchlist(previous, size, exclude).map((r) => r.symbol));
  const starredNow = new Set(pickWatchlist(today, size, exclude).map((r) => r.symbol));

  const watched = watchedCoins(starredBefore, open, scanSymbol);

  const text = formatCoinWatch(coinWatchChanges(today, previous, watched, starredNow, ctx.config.coinScan.thresholds), day);
  if (!text) return;
  let delivered = 0;
  for (const chatId of chatIds) if ((await ctx.notifier.send(chatId, text)).ok) delivered += 1;
  ctx.logger.info({ day, delivered, chats: chatIds.length }, 'coin watch alert sent');
}
