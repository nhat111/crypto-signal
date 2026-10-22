import {
  claimCoinWatchIntraday,
  getAllAlertSubscribers,
  getLatestCoinScan,
  getTrades,
  JOB_COIN_WATCH_INTRADAY,
  recordJobFailure,
  recordJobSuccess,
  type CoinScanRow,
} from '@crypto-signal/db';
import { pickWatchlist } from '@crypto-signal/indicators';
import type { OkxCoinScanData } from '@crypto-signal/market-data';
import type { CoinScanThresholds, CoinWatchIntradayThresholds } from '@crypto-signal/shared';
import type { WorkerContext } from './context.js';
import { scanSymbol } from './coinScan.js';
import { dayVi, escapeHtml, watchedCoins, type WatchedCoin } from './coinWatch.js';

/**
 * The exit alert between two daily closes. The daily check (coinWatch.ts)
 * compares two stored scan days, so a squeeze that ends at 10:00 is only
 * reported the next morning. This one reads the held and ⭐ coins every
 * hour and measures from the last daily close, on OKX: price, open
 * interest and funding, the three things that can change within a day.
 * Taker skew is not read: the daily bar it comes from is still forming.
 *
 * Every number is the coin against its own value at the close on one
 * exchange, so it does not matter which exchange the stored day came from.
 */

const DAY_MS = 86_400_000;

export type IntradayKind = 'long_unwind' | 'shorts_building' | 'short_covering' | 'funding_flip';

export interface IntradayRead {
  symbol: string;
  /** Percent, spot, since the last UTC midnight. */
  priceChangePct: number;
  /** Percent, coins, since the last UTC midnight. Null when the coin has no OKX perpetual or a point is missing. */
  oiChangePct: number | null;
  /** Funding settled since the close, per settlement period, as fractions. */
  fundingSettled: number[];
  /** The period now running. */
  fundingNow: number | null;
}

export interface IntradayFinding {
  symbol: string;
  watched: WatchedCoin;
  kind: IntradayKind;
  reason: string;
}

const signed = (n: number, digits = 1): string => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;

/**
 * Pure: which watched coins moved against holding them since the close.
 * The three price/OI cases are the daily exit labels (short_covering,
 * shorts_building, long_unwind) read over hours instead of a week, so the
 * thresholds are their own and smaller. The funding flip is the daily one
 * (shorts paying → positive) confirmed by a settled print, not by the
 * running estimate alone, which can swing within a period.
 */
export function intradayFindings(
  reads: IntradayRead[],
  rows: ReadonlyMap<string, CoinScanRow>,
  watched: ReadonlyMap<string, WatchedCoin>,
  t: CoinWatchIntradayThresholds,
  scan: CoinScanThresholds,
): IntradayFinding[] {
  const out: IntradayFinding[] = [];
  for (const r of reads) {
    const who = watched.get(r.symbol);
    if (!who) continue;
    const add = (kind: IntradayKind, reason: string): void => void out.push({ symbol: r.symbol, watched: who, kind, reason });

    const up = r.priceChangePct >= t.priceMovePct;
    const down = r.priceChangePct <= -t.priceMovePct;
    const oi = r.oiChangePct;
    const moved = oi === null ? '' : `giá ${signed(r.priceChangePct)}, OI ${signed(oi)}`;
    if (oi !== null && down && oi <= -t.oiChangePct) add('long_unwind', `Từ lúc đóng nến ngày: ${moved} — long đang đóng lệnh hoặc bị thanh lý.`);
    else if (oi !== null && down && oi >= t.oiChangePct) add('shorts_building', `Từ lúc đóng nến ngày: ${moved} — short mở thêm, đè giá xuống.`);
    else if (oi !== null && up && oi <= -t.oiChangePct) add('short_covering', `Từ lúc đóng nến ngày: ${moved} — giá lên nhờ short đóng lệnh, không phải tiền mới vào.`);

    const avg = rows.get(r.symbol)?.fundingAvg7dPct ?? null;
    const settledPositive = r.fundingSettled.length > 0 && r.fundingSettled.every((f) => f > 0);
    if (avg !== null && avg <= scan.fundingShortsPayPct && settledPositive && (r.fundingNow === null || r.fundingNow > 0)) {
      const last = r.fundingSettled[r.fundingSettled.length - 1] as number;
      add('funding_flip', `Funding 7 ngày là phe short trả (${avg.toFixed(4)}%/8h), từ lúc đóng nến đã sang dương (${(last * 100).toFixed(4)}%/kỳ): short đã rút, giờ là long đuổi giá.`);
    }
  }
  // Held coins first, as in the daily message.
  return out.sort((a, b) => Number(b.watched.held) - Number(a.watched.held) || a.symbol.localeCompare(b.symbol));
}

/** One message for the findings not sent earlier today; null when there are none. */
export function formatCoinWatchIntraday(findings: IntradayFinding[], closedDay: string): string | null {
  if (findings.length === 0) return null;
  const lines = [`⚡ <b>Coin đang theo dõi đổi trong ngày</b> (so với lúc đóng nến ${dayVi(closedDay)})`];
  let current = '';
  for (const f of findings) {
    if (f.symbol !== current) {
      current = f.symbol;
      const tags = [f.watched.held ? 'đang giữ' : null, f.watched.starred ? '⭐' : null].filter(Boolean).join(', ');
      lines.push('', `<b>${escapeHtml(f.symbol.replace(/USDT$/, ''))}</b> (${tags})`);
    }
    lines.push(`• ${escapeHtml(f.reason)}`);
  }
  lines.push(
    '',
    '<i>Giá, OI và funding trên OKX, đo từ lúc đóng nến ngày; mỗi thay đổi chỉ báo một lần trong ngày. Không phải lệnh bán: đối chiếu với thesis và điều kiện bán đã ghi trong Journal.</i>',
  );
  return lines.join('\n');
}

export interface IntradaySource {
  /** Null when the exchange has no spot pair for the coin. */
  read(symbol: string, now: number): Promise<IntradayRead | null>;
}

/**
 * OKX answers this server on the days Binance does not. OI is the daily
 * `1Dutc` series: a closed day's point is its last hourly value (checked
 * against `period=1H` on 22/10), so the stored day's point is the OI at
 * its close and the forming day's is the latest.
 */
export function okxIntradaySource(okx: OkxCoinScanData): IntradaySource {
  return {
    async read(symbol, now) {
      const spot = await okx.spotSinceDailyClose(symbol);
      if (!spot) return null;
      const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
      const points = await okx.dailyOpenInterest(symbol, 2);
      const atClose = points.find((p) => p.time === dayStart - DAY_MS)?.coins;
      const latest = points.find((p) => p.time === dayStart)?.coins;
      const oiChangePct = atClose !== undefined && latest !== undefined && atClose > 0 ? (latest / atClose - 1) * 100 : null;
      // No perpetual, no funding to ask for.
      const hasPerp = points.length > 0;
      const fundingSettled = hasPerp ? (await okx.fundingHistory(symbol, dayStart + 1)).map((f) => f.fundingRate) : [];
      const fundingNow = hasPerp ? await okx.currentFunding(symbol) : null;
      return { symbol, priceChangePct: (spot.last / spot.dailyClose - 1) * 100, oiChangePct, fundingSettled, fundingNow };
    },
  };
}

/**
 * Hourly. Reads only the coins someone holds or stars (a dozen or so, ~4
 * OKX calls each through the adapter's rate gate), claims each finding for
 * the UTC day before sending, and sends one message to the alert chats.
 * Nothing changed, nothing sent.
 */
export async function runCoinWatchIntraday(ctx: WorkerContext, now = Date.now(), source?: IntradaySource): Promise<void> {
  if (!ctx.config.coinScan.enabled) return;
  const src = source ?? (ctx.okxCoinScan ? okxIntradaySource(ctx.okxCoinScan) : null);
  if (!src) return;

  const [{ day, rows }, open, subscribers] = await Promise.all([
    getLatestCoinScan(ctx.pool),
    getTrades(ctx.pool, { status: 'open', limit: 500 }),
    getAllAlertSubscribers(ctx.pool),
  ]);
  const chatIds = Array.from(new Set([...ctx.config.telegramAlertChatIds, ...subscribers.map((s) => s.chatId)]));
  if (!day || chatIds.length === 0) return;

  // Today's ⭐, the list /coins shows right now.
  const exclude = [...ctx.config.symbols, ...ctx.config.futuresOnlySymbols];
  const starred = new Set(pickWatchlist(rows, ctx.config.coinScan.watchlistSize, exclude).map((r) => r.symbol));
  const watched = watchedCoins(starred, open, scanSymbol);
  if (watched.size === 0) return;

  const reads: IntradayRead[] = [];
  const failures: string[] = [];
  for (const symbol of watched.keys()) {
    try {
      const read = await src.read(symbol, now);
      if (read) reads.push(read);
    } catch (err) {
      failures.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (reads.length === 0 && failures.length > 0) {
    await recordJobFailure(ctx.pool, JOB_COIN_WATCH_INTRADAY, new Error(failures.slice(0, 5).join('; ')));
    return;
  }
  await recordJobSuccess(ctx.pool, JOB_COIN_WATCH_INTRADAY);

  const today = new Date(now).toISOString().slice(0, 10);
  const closedDay = new Date(Math.floor(now / DAY_MS) * DAY_MS - DAY_MS).toISOString().slice(0, 10);
  const findings = intradayFindings(reads, new Map(rows.map((r) => [r.symbol, r])), watched, ctx.config.coinScan.intraday, ctx.config.coinScan.thresholds);
  // Claimed before the send: a failed send loses one message, a send
  // without a claim would repeat every hour.
  const fresh: IntradayFinding[] = [];
  for (const f of findings) if (await claimCoinWatchIntraday(ctx.pool, today, f.symbol, f.kind)) fresh.push(f);

  const text = formatCoinWatchIntraday(fresh, closedDay);
  ctx.logger.info({ watched: watched.size, read: reads.length, failures, findings: findings.length, fresh: fresh.length }, 'coin watch intraday checked');
  if (!text) return;
  let delivered = 0;
  for (const chatId of chatIds) if ((await ctx.notifier.send(chatId, text)).ok) delivered += 1;
  ctx.logger.info({ delivered, chats: chatIds.length }, 'coin watch intraday alert sent');
}
