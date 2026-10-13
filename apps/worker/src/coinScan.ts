import {
  getLatestCoinScanDay,
  JOB_COIN_SCAN,
  recordJobFailure,
  recordJobSuccess,
  saveCoinScan,
  type CoinScanExchange,
  type CoinScanInput,
} from '@crypto-signal/db';
import {
  BENCHMARK_SYMBOL,
  fundingPer8h,
  isStableLike,
  pickCoinUniverse,
  readCoin,
  type CoinDailyBar,
  type CoinUniverseEntry,
  type Ticker24h,
} from '@crypto-signal/indicators';
import { BinanceRestError, type BinanceFuturesAdapter, type BinanceSpotAdapter, type OkxCoinScanData } from '@crypto-signal/market-data';
import type { CoinScanConfig } from '@crypto-signal/shared';
import type { WorkerContext } from './context.js';
import { readCoinFundamentals } from './coinFundamentals.js';

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
  dailyOpenInterest(futuresSymbol: string): Promise<number[]>;
  /** Funding over the last seven days, scaled to 8h. */
  funding7d(futuresSymbol: string, now: number): Promise<number[]>;
}

export function binanceCoinScanSource(spot: BinanceSpotAdapter, futures: BinanceFuturesAdapter): CoinScanSource {
  return {
    spotTickers: () => spot.fetch24hTickers(),
    futuresTickers: () => futures.fetch24hTickers(),
    dailyBars: (symbol, now) => spot.fetchClosedFlowBars(symbol, '1d', DAILY_BARS, now),
    dailyOpenInterest: async (symbol) => (await futures.fetchDailyOpenInterest(symbol, OI_POINTS)).map((p) => p.contracts),
    funding7d: async (symbol, now) => fundingPer8h(await futures.fetchFundingRateHistory(symbol, { startTime: now - 7 * DAY_MS, limit: 200 })),
  };
}

/**
 * The same reads from OKX, for when Binance refuses this server. Spot,
 * perps and taker split all from OKX, so one stored day never mixes two
 * exchanges' order flow — their taker skews disagree in sign on some coins
 * (BNB, TRX), which is a real difference between venues, not noise.
 */
export function okxCoinScanSource(okx: OkxCoinScanData): CoinScanSource {
  return {
    spotTickers: () => okx.spotTickers(),
    futuresTickers: () => okx.swapTickers(),
    dailyBars: (symbol, now) => okx.dailyFlowBars(symbol, DAILY_BARS, now),
    dailyOpenInterest: (symbol) => okx.dailyOpenInterest(symbol, OI_POINTS),
    funding7d: async (symbol, now) => fundingPer8h(await okx.fundingHistory(symbol, now - 7 * DAY_MS)),
  };
}

export interface CoinScanResult {
  /** YYYY-MM-DD of BTC's last closed bar — the day every stored row describes. */
  day: string;
  inputs: CoinScanInput[];
  /** Per-coin problems that did not stop the scan. */
  skipped: string[];
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

      const { oi, funding } = futuresBanned ? { oi: null, funding: null } : await readLeverage(source, entry, now).catch((err: unknown) => {
        if (isRefused(err)) futuresBanned = true;
        skipped.push(`${entry.symbol}: futures read failed — ${message(err)}`);
        return { oi: null, funding: null };
      });

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

  return { day, inputs, skipped };
}

async function readLeverage(source: CoinScanSource, entry: CoinUniverseEntry, now: number): Promise<{ oi: number[] | null; funding: number[] | null }> {
  if (!entry.futuresSymbol) return { oi: null, funding: null };
  const oi = await source.dailyOpenInterest(entry.futuresSymbol);
  const funding = await source.funding7d(entry.futuresSymbol, now);
  return { oi, funding };
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
  try {
    return { result: await scanCoins(binance, config, now), exchange: 'binance', binanceError: null };
  } catch (err) {
    if (!okx || !isRefused(err)) throw err;
    try {
      return { result: await scanCoins(okx, config, now), exchange: 'okx', binanceError: message(err) };
    } catch (okxErr) {
      throw new Error(`${message(err)} — OKX fallback failed too: ${message(okxErr)}`);
    }
  }
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

  try {
    const { result, exchange, binanceError } = await scanWithFallback(
      source ?? binanceCoinScanSource(ctx.spotAdapter, ctx.futuresAdapter),
      source ? null : ctx.okxCoinScan ? okxCoinScanSource(ctx.okxCoinScan) : null,
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
    const inputs = result.inputs.map((i) => ({ ...i, fundamentals: fundamentals?.get(i.read.symbol.replace(/USDT$/, '')) ?? null }));

    await saveCoinScan(ctx.pool, result.day, inputs, exchange);
    await recordJobSuccess(ctx.pool, JOB_COIN_SCAN);
    if (binanceError) ctx.logger.warn({ binanceError }, 'coin scan read from OKX — Binance refused the server');
    ctx.logger.info({ day: result.day, exchange, coins: result.inputs.length, skipped: result.skipped }, 'coin scan stored');
  } catch (err) {
    await recordJobFailure(ctx.pool, JOB_COIN_SCAN, err).catch(() => undefined);
    throw err;
  }
}
