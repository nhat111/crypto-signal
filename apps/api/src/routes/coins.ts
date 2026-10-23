import type { FastifyInstance } from 'fastify';
import { COIN_EDGE_HORIZONS, COIN_EDGE_MIN_SAMPLES, getCoinScanEdge, getJobHealth, getLatestCoinScan, getOpenTradeSetups, JOB_COIN_SCAN } from '@crypto-signal/db';
import { pickWatchlist } from '@crypto-signal/indicators';
import { OkxCoinScanData, type Ticker24hRow } from '@crypto-signal/market-data';
import { createLogger } from '@crypto-signal/shared';
import type { ApiDeps } from '../deps.js';

/** How long one read of OKX's tickers is reused. Every open /coins tab polls this; one ticker call per window serves them all. */
const LIVE_CACHE_MS = 30_000;

export interface LivePrices {
  source: 'okx';
  /** When OKX was read (ms). */
  at: number;
  /** Last trade price per scanned symbol and per open setup's symbol; a coin OKX does not list is absent. */
  prices: Record<string, number>;
}

/** The scanned coins' last prices out of OKX's whole spot ticker list. Pure for testing. */
export function pickLivePrices(tickers: Ticker24hRow[], symbols: string[]): Record<string, number> {
  const wanted = new Set(symbols);
  const prices: Record<string, number> = {};
  for (const t of tickers) {
    if (wanted.has(t.symbol) && Number.isFinite(t.lastPrice) && t.lastPrice > 0) prices[t.symbol] = t.lastPrice;
  }
  return prices;
}

/**
 * The wide coin scan: the latest day's read of the most-traded coins.
 *
 * `enabled` and `fetch` travel with the rows because an empty list has
 * three different causes — switched off, not run yet, failing — and the
 * page has to say which one it is.
 */
export function registerCoinsRoute(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/coins', async () => {
    const [scan, health] = await Promise.all([getLatestCoinScan(deps.pool), getJobHealth(deps.pool, JOB_COIN_SCAN)]);
    return {
      enabled: deps.config.coinScan.enabled,
      day: scan.day,
      // One day is read from one exchange; null before the first scan.
      exchange: scan.rows[0]?.exchange ?? null,
      rows: scan.rows,
      // The coins whose 4H setups are alerted, by the same rule the worker
      // applies to this same scan. Empty when coin setups are off.
      watchlist: deps.config.coinScan.setups
        ? pickWatchlist(scan.rows, deps.config.coinScan.watchlistSize, [...deps.config.symbols, ...deps.config.futuresOnlySymbols]).map((r) => r.symbol)
        : [],
      thresholds: deps.config.coinScan.thresholds,
      fetch: health
        ? {
            lastAttemptAt: health.lastAttemptAt,
            lastSuccessAt: health.lastSuccessAt,
            consecutiveFailures: health.consecutiveFailures,
            lastError: health.lastError,
          }
        : null,
    };
  });

  /**
   * The scanned coins' price right now, beside the scan's daily close.
   *
   * The scan reads closed daily bars, so its price is yesterday's close
   * for the whole day after it runs — on 15/10 NEAR showed 4.888 while it
   * traded at 5.26, and read as a wrong price. This answers "where is it
   * now" without touching the scan: the 7/30-day columns and the label
   * stay on the close they were computed from.
   *
   * Always OKX, whichever exchange the scan day used: Binance refuses the
   * production server's IP, and the two differ by about 0.1% on these
   * coins. Same on-demand pattern as /api/lookup; nothing is stored.
   *
   * Open setups' symbols are priced too, so a setup card can say how far
   * the price has moved since its 4H close — including a coin that has
   * since left the top 30 while its setup is still open.
   */
  const logger = createLogger('coins-live', deps.config.logLevel);
  const okx = new OkxCoinScanData({ logger });
  let cache: { at: number; tickers: Ticker24hRow[] } | null = null;
  let inFlight: Promise<Ticker24hRow[]> | null = null;

  const tickers = async (now: number): Promise<{ at: number; tickers: Ticker24hRow[] }> => {
    if (cache && now - cache.at < LIVE_CACHE_MS) return cache;
    // Concurrent requests share one read rather than each starting their own.
    inFlight ??= okx.spotTickers().finally(() => {
      inFlight = null;
    });
    const read = await inFlight;
    cache = { at: Date.now(), tickers: read };
    return cache;
  };

  app.get('/api/coins/live', async (_req, reply) => {
    const [scan, open] = await Promise.all([getLatestCoinScan(deps.pool), getOpenTradeSetups(deps.pool)]);
    try {
      const { at, tickers: rows } = await tickers(Date.now());
      const symbols = [...scan.rows.map((r) => r.symbol), ...open.map((s) => s.symbol)];
      const body: LivePrices = { source: 'okx', at, prices: pickLivePrices(rows, symbols) };
      return body;
    } catch (err) {
      logger.warn({ err }, 'coins live prices failed');
      return reply.code(502).send({ error: 'không đọc được giá hiện tại từ OKX' });
    }
  });

  /**
   * Whether the scan's groups went on to beat BTC: the top fifth by RS
   * against the bottom fifth, and each flow label against all coins, per
   * exchange. `verdict` stays null below `minSamples`.
   */
  app.get<{ Querystring: { horizon?: string } }>('/api/coins/edge', async (req, reply) => {
    const horizon = Number(req.query.horizon ?? 7);
    if (!(COIN_EDGE_HORIZONS as readonly number[]).includes(horizon)) {
      return reply.code(400).send({ error: `horizon must be one of ${COIN_EDGE_HORIZONS.join(', ')}` });
    }
    return { horizonDays: horizon, minSamples: COIN_EDGE_MIN_SAMPLES, reports: await getCoinScanEdge(deps.pool, horizon) };
  });
}
