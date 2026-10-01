import {
  claimDailyDigest,
  getAllAlertSubscribers,
  getOverview,
  getRecentSignals,
  JOB_DAILY_DIGEST,
  JOB_TREND_1D,
  recordDigestRecipients,
  recordJobFailure,
  recordJobSuccess,
  upsertTrendState,
  type OverviewRow,
  type RecentSignalRow,
  type TrendUpsertResult,
} from '@crypto-signal/db';
import { readMarketStructure } from '@crypto-signal/indicators';
import { SEVERITY_ORDER } from '@crypto-signal/signal-engine';
import type { WorkerContext } from './context.js';

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

  const symbols = [
    ...ctx.config.symbols.map((symbol) => ({ symbol, adapter: ctx.spotAdapter })),
    ...ctx.config.futuresOnlySymbols.map((symbol) => ({ symbol, adapter: ctx.futuresAdapter })),
  ];

  for (const { symbol, adapter } of symbols) {
    try {
      const bars = await adapter.fetchClosedDailyBars(symbol, DAILY_BARS, now);
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
          reasons: structure.reasons,
        }),
      );
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

  const changed = results.filter((r) => r.labelChanged || r.newEvent).map((r) => ({ symbol: r.row.symbol, trend: r.row.trend, event: r.row.event }));
  if (changed.length > 0) ctx.logger.info({ changed }, 'daily structure changed');

  await maybeSendDigest(ctx, results, now);
}

async function maybeSendDigest(ctx: WorkerContext, results: TrendUpsertResult[], now: number): Promise<void> {
  if (!ctx.config.dailyDigest) return;

  const latestOpen = Math.max(...results.map((r) => r.row.lastCloseTime));
  const closedAt = latestOpen + DAY_MS;
  if (now - closedAt > DIGEST_WINDOW_MS) return;

  const subscribers = await getAllAlertSubscribers(ctx.pool);
  const chatIds = Array.from(new Set([...ctx.config.telegramAlertChatIds, ...subscribers.map((s) => s.chatId)]));
  if (chatIds.length === 0) return;

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
    const text = formatDigest(results, overview, signals.filter((s) => s.timestamp >= now - DAY_MS), closedAt);

    let delivered = 0;
    for (const chatId of chatIds) {
      const sent = await ctx.notifier.send(chatId, text);
      if (sent.ok) delivered += 1;
    }
    await recordDigestRecipients(ctx.pool, day, delivered);
    await recordJobSuccess(ctx.pool, JOB_DAILY_DIGEST);
    ctx.logger.info({ day, delivered, chats: chatIds.length }, 'daily digest sent');
  } catch (err) {
    await recordJobFailure(ctx.pool, JOB_DAILY_DIGEST, err).catch(() => undefined);
    throw err;
  }
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
): string {
  const date = new Date(closedAt - 1).toISOString().slice(0, 10).split('-').reverse().join('/');
  const lines: string[] = [`☀️ <b>Tóm tắt sau nến 1D ngày ${date}</b>`, ''];

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
  lines.push('', '<i>Xu hướng đọc theo đỉnh/đáy trên nến ngày đã đóng. Mô tả, không phải dự báo.</i>');
  return lines.join('\n');
}
