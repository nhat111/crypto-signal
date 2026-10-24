import {
  JOB_SPOT_BREAKOUTS,
  closeSpotBreakout,
  getJobHealth,
  getOpenSpotBreakouts,
  insertSpotBreakout,
  recordJobFailure,
  recordJobSuccess,
  updateSpotBreakoutTrail,
  upsertSpotBreakoutRun,
} from '@crypto-signal/db';
import { breakoutResult, detectBreakout, readBreakoutRegime, stepBreakout, type OhlcvBar } from '@crypto-signal/indicators';
import type { WorkerContext } from './context.js';

const DAY_MS = 86_400_000;
/** Enough for EMA200 and the 20-day lookback, and for following a position held up to ~6 months. */
const DAILY_BARS = 400;
const GAP_MS = 250;
const BENCHMARK = 'BTCUSDT';

export type FetchDaily = (symbol: string, limit: number, now: number) => Promise<OhlcvBar[]>;

/**
 * The daily spot breakout list (ASSUMPTIONS §27), on OKX daily bars.
 *
 * Hourly tick, one real run per UTC day: the first run after the daily
 * close does the work and later ones return at once. Each open position
 * is walked forward to today (trail raised, or closed at its stop or
 * trail), then — only while BTC's regime is up — each coin without an
 * open position is checked for a breakout on the day just closed. A coin
 * that exited today is not re-entered the same day, as in the replay.
 *
 * Nothing is pushed to Telegram: the list is read on /breakouts and the
 * Overview until the live record says the rule holds up.
 *
 * OKX only: Binance refuses the production server, and a position is
 * followed on the bars of the exchange that found it.
 */
export async function runSpotBreakoutCycle(ctx: WorkerContext, now = Date.now(), fetchDaily?: FetchDaily): Promise<void> {
  const cfg = ctx.config.spotBreakouts;
  if (!cfg.enabled) return;
  const okx = ctx.okxSpot;
  const fetch: FetchDaily | null = fetchDaily ?? (okx ? (s, limit, at) => okx.fetchClosedDailyBars(s, limit, at) : null);
  if (!fetch) return;

  const today = Math.floor(now / DAY_MS);
  const health = await getJobHealth(ctx.pool, JOB_SPOT_BREAKOUTS);
  if (health?.lastSuccessAt != null && Math.floor(health.lastSuccessAt / DAY_MS) === today) return;

  try {
    const btc = await fetch(BENCHMARK, DAILY_BARS, now);
    const regime = readBreakoutRegime(btc);
    if (!regime) throw new Error(`BTC daily bars too short for the regime (${btc.length})`);

    const open = new Map((await getOpenSpotBreakouts(ctx.pool)).map((p) => [p.symbol, p] as const));
    const symbols = [...new Set([...cfg.symbols, ...open.keys()])];
    let read = 0;
    let found = 0;
    let closed = 0;
    const failures: string[] = [];

    for (const [i, symbol] of symbols.entries()) {
      if (i > 0 && !fetchDaily) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
      try {
        const bars = symbol === BENCHMARK ? btc : await fetch(symbol, DAILY_BARS, now);
        read += 1;
        const position = open.get(symbol);
        if (position) {
          const step = stepBreakout(position, bars);
          if (step.status === 'open') {
            await updateSpotBreakoutTrail(ctx.pool, position.id, step.trail);
          } else {
            const { returnPct, r } = breakoutResult(position.entry, position.stop, step.exitPrice);
            await closeSpotBreakout(ctx.pool, position.id, { ...step, returnPct, rMultiple: r });
            closed += 1;
          }
          continue;
        }
        if (!regime.up) continue;
        const candidate = detectBreakout(bars);
        // Only the day BTC's regime was read on: a coin whose bars stop
        // earlier (delisted, a stale feed) must not be entered on old news.
        if (!candidate || candidate.barOpenTime !== regime.barOpenTime) continue;
        const row = await insertSpotBreakout(ctx.pool, { symbol, exchange: 'okx', ...candidate });
        if (row) {
          found += 1;
          ctx.logger.info({ symbol, entry: row.entry, stop: row.stop, stopPct: candidate.stopPct }, 'spot breakout found');
        }
      } catch (err) {
        failures.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (read === 0) throw new Error(failures.join('; ') || 'no symbols read');
    await upsertSpotBreakoutRun(ctx.pool, {
      day: new Date(regime.barOpenTime).toISOString().slice(0, 10),
      regimeUp: regime.up,
      btcClose: regime.close,
      btcEma50: regime.ema50,
      btcEma200: regime.ema200,
      coinsRead: read,
      found,
      closed,
    });
    await recordJobSuccess(ctx.pool, JOB_SPOT_BREAKOUTS);
    ctx.logger.info({ regimeUp: regime.up, read, found, closed, failures: failures.length }, 'spot breakout cycle done');
    if (failures.length > 0) ctx.logger.warn({ failures }, 'spot breakout read failed for some symbols');
  } catch (err) {
    await recordJobFailure(ctx.pool, JOB_SPOT_BREAKOUTS, err);
    throw err;
  }
}
