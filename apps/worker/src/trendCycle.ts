import {
  claimDailyDigest,
  getCoinScanEdge,
  getCoinScanForDay,
  getOpenTradeSetups,
  getOverview,
  getRecentSignals,
  getTrades,
  JOB_DAILY_DIGEST,
  JOB_SETUP_SCAN,
  JOB_TREND_1D,
  recordDigestBody,
  recordDigestForChat,
  recordDigestRecipients,
  recordJobFailure,
  recordJobSuccess,
  upsertTrendState,
  type CoinScanRow,
  type OverviewRow,
  type RecentSignalRow,
  type TrendUpsertResult,
} from '@crypto-signal/db';
import { readMarketStructure } from '@crypto-signal/indicators';
import type { RiskProfile } from '@crypto-signal/shared';
import { SEVERITY_ORDER } from '@crypto-signal/signal-engine';
import type { WorkerContext } from './context.js';
import { formatCoinDigest } from './coinDigest.js';
import { scanSymbol } from './coinScan.js';
import { formatPersonalDigest } from './personalDigest.js';
import { alertChatsWithProfiles, scanSetups } from './setupScan.js';
import { OKX_TREND_REASON, fetchDailyBarsWithFallback } from './dailyBars.js';

/** 400 closed days covers EMA200 with room for the seed window. */
const DAILY_BARS = 400;
const DAY_MS = 86_400_000;
/**
 * A digest is a morning message. If the worker was down through the
 * morning, a summary of yesterday's close arriving at dinner is noise, so
 * it is skipped rather than sent late.
 */
const DIGEST_WINDOW_MS = 12 * 60 * 60_000;
/**
 * The coin scan runs on the same hourly tick as this, so on a given morning
 * either may finish first. The digest waits this long for the day's scan,
 * then goes without it — a morning message an hour late beats one missing.
 */
const COIN_SCAN_WAIT_MS = 2 * 60 * 60_000;

/**
 * Reads the daily structure for every tracked symbol, stores it, and — once
 * per UTC day, after the daily close — sends one summary to every alert
 * chat.
 *
 * Runs hourly. Most runs re-read the same closed bar and change nothing;
 * that is cheap (one request per symbol) and means a worker that starts at
 * any hour catches up on its next tick instead of waiting a day.
 */
export async function runTrendCycle(ctx: WorkerContext, now = Date.now()): Promise<void> {
  const results: TrendUpsertResult[] = [];
  const failures: string[] = [];
  const setupFailures: string[] = [];
  let setupScans = 0;

  const symbols = [
    ...ctx.config.symbols.map((symbol) => ({ symbol, adapter: ctx.spotAdapter })),
    ...ctx.config.futuresOnlySymbols.map((symbol) => ({ symbol, adapter: ctx.futuresAdapter })),
  ];

  const okx = ctx.okxSpot ?? null;
  for (const { symbol, adapter } of symbols) {
    try {
      // Futures-only symbols have no spot pair to fall back to.
      const { bars, source } = await fetchDailyBarsWithFallback(
        (s, limit, at) => adapter.fetchClosedDailyBars(s, limit, at),
        adapter === ctx.spotAdapter && okx ? (s, limit, at) => okx.fetchClosedDailyBars(s, limit, at) : null,
        symbol,
        DAILY_BARS,
        now,
      );
      if (source !== 'binance') ctx.logger.warn({ symbol, source }, 'daily bars read from fallback — Binance refused the server');
      const structure = readMarketStructure(bars);
      if (!structure) {
        failures.push(`${symbol}: not enough daily history`);
        continue;
      }
      results.push(
        await upsertTrendState(ctx.pool, {
          symbol,
          lastCloseTime: structure.lastCloseTime,
          lastClose: structure.lastClose,
          trend: structure.trend,
          event: structure.event,
          ema: structure.ema,
          emaPeriod: structure.emaPeriod,
          aboveEma: structure.aboveEma,
          swingHighs: structure.swingHighs,
          swingLows: structure.swingLows,
          reasons: source === 'binance' ? structure.reasons : [...structure.reasons, OKX_TREND_REASON],
        }),
      );
      // Setups are spot-only: a futures-only symbol has no spot market to
      // buy on, and buying spot is the only thing these plans describe.
      // The 4H bars come from the same exchange as the daily ones, and each
      // setup is stamped with it: Binance refusing the server used to skip
      // the scan outright, which went on for three days unnoticed.
      if (adapter === ctx.spotAdapter && (source === 'binance' || okx)) {
        try {
          const fetch4h =
            source === 'binance' || !okx
              ? (s: string, limit: number, at: number) => ctx.spotAdapter.fetchClosedBars(s, '4h', limit, at)
              : (s: string, limit: number, at: number) => okx.fetchClosedBars(s, '4h', limit, at);
          await scanSetups(ctx, symbol, bars, structure, now, source, fetch4h, { cohort: 'core', context: null, alert: ctx.config.setupAlerts });
          setupScans += 1;
        } catch (err) {
          setupFailures.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      failures.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (results.length === 0) {
    await recordJobFailure(ctx.pool, JOB_TREND_1D, new Error(failures.join('; ') || 'no symbols'));
    return;
  }
  // Partial success still counts as the job running; the failures are logged
  // per symbol so one delisted pair does not paint the whole job red.
  await recordJobSuccess(ctx.pool, JOB_TREND_1D);
  if (failures.length > 0) ctx.logger.warn({ failures }, 'trend read failed for some symbols');

  if (setupScans > 0) await recordJobSuccess(ctx.pool, JOB_SETUP_SCAN);
  else if (setupFailures.length > 0) await recordJobFailure(ctx.pool, JOB_SETUP_SCAN, new Error(setupFailures.join('; ')));
  if (setupFailures.length > 0) ctx.logger.warn({ setupFailures }, 'setup scan failed for some symbols');

  const changed = results.filter((r) => r.labelChanged || r.newEvent).map((r) => ({ symbol: r.row.symbol, trend: r.row.trend, event: r.row.event }));
  if (changed.length > 0) ctx.logger.info({ changed }, 'daily structure changed');

  await maybeSendDigest(ctx, results, now);
}

async function maybeSendDigest(ctx: WorkerContext, results: TrendUpsertResult[], now: number): Promise<void> {
  if (!ctx.config.dailyDigest) return;

  const latestOpen = Math.max(...results.map((r) => r.row.lastCloseTime));
  const closedAt = latestOpen + DAY_MS;
  if (now - closedAt > DIGEST_WINDOW_MS) return;

  const { chatIds, profileOf } = await alertChatsWithProfiles(ctx);
  if (chatIds.length === 0) return;

  const barDay = new Date(latestOpen).toISOString().slice(0, 10);
  const coins = ctx.config.coinScan.enabled ? await getCoinScanForDay(ctx.pool, barDay) : [];
  if (ctx.config.coinScan.enabled && coins.length === 0 && now - closedAt < COIN_SCAN_WAIT_MS) return;

  // The claim comes after every early return, so a skipped day stays
  // claimable — but before the send, so a restart mid-send cannot repeat it.
  const day = new Date(closedAt).toISOString().slice(0, 10);
  if (!(await claimDailyDigest(ctx.pool, day))) return;

  try {
    const symbols = results.map((r) => r.row.symbol);
    const [overview, signals] = await Promise.all([
      getOverview(ctx.pool, symbols, ['4h']),
      getRecentSignals(ctx.pool, { timeframes: ['4h'], limit: 100 }),
    ]);
    const previousCoins = coins.length > 0 ? await getCoinScanForDay(ctx.pool, new Date(latestOpen - DAY_MS).toISOString().slice(0, 10)) : [];
    // The evidence line is a nice-to-have: a failed query must not cost the morning message.
    const edge = coins.length > 0 ? await getCoinScanEdge(ctx.pool, 7).catch(() => []) : [];
    const recentSignals = signals.filter((s) => s.timestamp >= now - DAY_MS);
    const coinLines = formatCoinDigest(coins, previousCoins, edge);
    const shared = formatDigest(results, overview, recentSignals, closedAt, coinLines);
    // Stored before sending, so /digest has it even if every send fails. A
    // failed write only costs /digest, never the morning message.
    const keep = (write: Promise<void>): Promise<void> => write.catch((err: unknown) => ctx.logger.warn({ err, day }, 'could not store digest text'));
    await keep(recordDigestBody(ctx.pool, day, shared));

    // The personal section is extra: a failed read sends everyone the shared text.
    const personal = await readPersonalDigest(ctx, results, coins, previousCoins).catch((err: unknown) => {
      ctx.logger.warn({ err }, 'digest personal section unavailable — sending the shared text');
      return null;
    });

    let delivered = 0;
    for (const chatId of chatIds) {
      const text = personal ? formatDigest(results, overview, recentSignals, closedAt, coinLines, personal(chatId, profileOf(chatId))) : shared;
      const sent = await ctx.notifier.send(chatId, text);
      if (!sent.ok) continue;
      delivered += 1;
      if (text !== shared) await keep(recordDigestForChat(ctx.pool, day, chatId, text));
    }
    await recordDigestRecipients(ctx.pool, day, delivered);
    await recordJobSuccess(ctx.pool, JOB_DAILY_DIGEST);
    ctx.logger.info({ day, delivered, chats: chatIds.length }, 'daily digest sent');
  } catch (err) {
    await recordJobFailure(ctx.pool, JOB_DAILY_DIGEST, err).catch(() => undefined);
    throw err;
  }
}

/**
 * Reads what every chat's "Của bạn" section needs once, and returns the
 * per-chat formatter. Prices are the same daily closes the rest of the
 * digest reads: the trend read for the core symbols, the scan for the rest.
 */
async function readPersonalDigest(
  ctx: WorkerContext,
  results: TrendUpsertResult[],
  today: CoinScanRow[],
  previous: CoinScanRow[],
): Promise<(chatId: string, profile: RiskProfile | null) => string[]> {
  const [open, openSetups] = await Promise.all([getTrades(ctx.pool, { status: 'open', limit: 500 }), getOpenTradeSetups(ctx.pool)]);
  const prices = new Map<string, number>(today.map((r) => [r.symbol, r.close]));
  for (const r of results) prices.set(r.row.symbol, r.row.lastClose);
  // The baseline cohort is never alerted, so it is not anyone's setup to act on.
  const setups = openSetups.filter((s) => s.cohort !== 'scan');
  return (chatId, profile) =>
    formatPersonalDigest({ openTrades: open.filter((t) => t.chatId === chatId), prices, today, previous, setups, profile }, scanSymbol);
}

const TREND_LABEL: Record<string, string> = {
  up: '🟢 Tăng',
  down: '🔴 Giảm',
  sideways: '⚪ Đi ngang',
};

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const price = (n: number): string =>
  n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(5).replace(/\.?0+$/, '');

/**
 * One message, read top to bottom in under a minute: what the daily
 * structure is for each coin, what changed on this close, and the handful
 * of 4h signals worth a look. Pure, so the wording is tested without a bot.
 */
export function formatDigest(
  results: TrendUpsertResult[],
  overview: OverviewRow[],
  signals: RecentSignalRow[],
  closedAt: number,
  coinLines: string[] = [],
  personalLines: string[] = [],
): string {
  const date = new Date(closedAt - 1).toISOString().slice(0, 10).split('-').reverse().join('/');
  const lines: string[] = [`☀️ <b>Tóm tắt sau nến 1D ngày ${date}</b>`, ''];
  // The reader's own positions first: the part only this chat gets.
  if (personalLines.length > 0) lines.push(...personalLines, '');

  for (const r of results) {
    const row = r.row;
    const ov = overview.find((o) => o.symbol === row.symbol);
    const ema = row.aboveEma === null ? '' : row.aboveEma ? ` · trên EMA${row.emaPeriod}` : ` · dưới EMA${row.emaPeriod}`;
    lines.push(`<b>${escapeHtml(row.symbol)}</b> ${price(row.lastClose)} — ${TREND_LABEL[row.trend] ?? row.trend}${ema}`);

    if (r.newEvent && row.event === 'up_broken') lines.push('  ⚠️ <b>Vừa gãy cấu trúc tăng</b> — đóng nến dưới đáy gần nhất.');
    else if (r.newEvent && row.event === 'down_broken') lines.push('  ✅ <b>Vừa gãy cấu trúc giảm</b> — đóng nến trên đỉnh gần nhất.');
    else if (r.labelChanged && row.previousTrend)
      lines.push(`  ↪️ Đổi từ ${TREND_LABEL[row.previousTrend] ?? row.previousTrend} sang ${TREND_LABEL[row.trend] ?? row.trend}.`);

    if (ov) {
      const health = ov.healthScore === null ? '—' : String(Math.round(ov.healthScore));
      lines.push(`  Health ${health} · Risk ${Math.round(ov.riskScore)} (4h)`);
    }
  }

  const notable = [...signals]
    .sort(
      (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity) || b.confidence - a.confidence,
    )
    .slice(0, 3);
  lines.push('');
  if (notable.length === 0) {
    lines.push('Tín hiệu 4h trong 24h qua: không có.');
  } else {
    lines.push(`Tín hiệu 4h trong 24h qua: ${signals.length}. Đáng chú ý:`);
    for (const s of notable) {
      lines.push(`• ${escapeHtml(s.symbol)} — ${escapeHtml(s.signalType.replace(/_/g, ' '))} (${s.severity}, ${Math.round(s.confidence)}%)`);
    }
  }
  if (coinLines.length > 0) lines.push('', ...coinLines);
  lines.push('', '<i>Xu hướng đọc theo đỉnh/đáy trên nến ngày đã đóng. Mô tả, không phải dự báo.</i>');
  return lines.join('\n');
}
