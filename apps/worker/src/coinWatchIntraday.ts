import {
  claimCoinWatchIntraday,
  getAllAlertSubscribers,
  getLatestCoinScan,
  getTrades,
  JOB_COIN_WATCH_INTRADAY,
  recordJobFailure,
  recordJobSuccess,
  type CoinScanRow,
  type TradeRow,
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
  /** Spot, now. */
  price: number;
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

/** How close to its stop a trade must be, as the share of the entry-to-stop distance still left, to be warned about. */
const NEAR_STOP_SHARE = 0.25;

export type StopKind = 'stop_hit' | 'stop_near';

export interface StopFinding {
  trade: Pick<TradeRow, 'id' | 'chatId' | 'symbol' | 'side' | 'entryPrice' | 'stopPrice'>;
  kind: StopKind;
  price: number;
}

/**
 * Pure: open journal trades at or near the stop their owner wrote down.
 * Hit is the price on the stop or past it; near is three quarters of the
 * way from the entry to it. Read at the hour, so a wick through the stop
 * between two reads is missed — this is a reminder of the plan, not an
 * order on the exchange.
 */
export function stopFindings(trades: ReadonlyArray<StopFinding['trade']>, prices: ReadonlyMap<string, number>): StopFinding[] {
  const out: StopFinding[] = [];
  for (const t of trades) {
    const price = prices.get(scanSymbol(t.symbol));
    if (t.stopPrice === null || price === undefined) continue;
    const short = t.side === 'short';
    const left = short ? t.stopPrice - price : price - t.stopPrice;
    const room = Math.abs(t.entryPrice - t.stopPrice);
    if (left <= 0) out.push({ trade: t, kind: 'stop_hit', price });
    else if (room > 0 && left / room <= NEAR_STOP_SHARE) out.push({ trade: t, kind: 'stop_near', price });
  }
  return out;
}

/** One message per chat for its trades' stops; null when there are none. */
export function formatStopAlert(findings: StopFinding[]): string | null {
  if (findings.length === 0) return null;
  const price = (n: number): string => `$${n.toPrecision(6).replace(/\.?0+$/, '')}`;
  const lines = ['🛑 <b>Lệnh trong Journal chạm hoặc gần stop</b>'];
  for (const f of findings) {
    const t = f.trade;
    const coin = escapeHtml(t.symbol.replace(/USDT$/, ''));
    const head = `<b>${coin}</b> ${t.side.toUpperCase()} · giá ${price(f.price)}, stop ${price(t.stopPrice as number)} (vào ${price(t.entryPrice)})`;
    lines.push(
      '',
      head,
      f.kind === 'stop_hit'
        ? '• Đã chạm mức cắt lỗ bạn đặt.'
        : `• Còn cách stop ${((Math.abs(f.price - (t.stopPrice as number)) / f.price) * 100).toFixed(1)}%: đã đi hơn 3/4 quãng từ giá vào tới stop.`,
    );
  }
  lines.push(
    '',
    '<i>Giá spot OKX, đọc mỗi giờ. Đây là kế hoạch bạn đã ghi, không phải lệnh trên sàn. Thoát rồi thì /close SYMBOL GIÁ để ghi kết quả theo R; dời stop xa hơn là biến mức lỗ đã biết thành không giới hạn.</i>',
  );
  return lines.join('\n');
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
      return { symbol, price: spot.last, priceChangePct: (spot.last / spot.dailyClose - 1) * 100, oiChangePct, fundingSettled, fundingNow };
    },
  };
}

/**
 * Hourly. Reads only the coins someone holds, stars or has a stop on (a
 * dozen or so, ~4 OKX calls each through the adapter's rate gate), claims
 * each finding for the UTC day before sending, and sends: the ⚡ message
 * to the alert chats, each stop message to the chat that logged the trade
 * (web trades to the alert chats). Nothing changed, nothing sent.
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

  // Today's ⭐, the list /coins shows right now.
  const exclude = [...ctx.config.symbols, ...ctx.config.futuresOnlySymbols];
  const starred = day ? new Set(pickWatchlist(rows, ctx.config.coinScan.watchlistSize, exclude).map((r) => r.symbol)) : new Set<string>();
  const watched = chatIds.length > 0 ? watchedCoins(starred, open, scanSymbol) : new Map<string, WatchedCoin>();
  // Shorts are read too when they carry a stop: the stop protects them as much as a long.
  const withStop = open.filter((t) => t.stopPrice !== null);
  const symbols = new Set([...watched.keys(), ...withStop.map((t) => scanSymbol(t.symbol))]);
  if (symbols.size === 0) return;

  const reads: IntradayRead[] = [];
  const failures: string[] = [];
  for (const symbol of symbols) {
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

  // A stop is claimed per trade, not per coin: two chats holding the same
  // coin each get their own reminder.
  const stops = stopFindings(withStop, new Map(reads.map((r) => [r.symbol, r.price])));
  const freshStops: StopFinding[] = [];
  for (const f of stops) if (await claimCoinWatchIntraday(ctx.pool, today, scanSymbol(f.trade.symbol), `${f.kind}:${f.trade.id}`)) freshStops.push(f);

  ctx.logger.info(
    { watched: watched.size, read: reads.length, failures, findings: findings.length, fresh: fresh.length, stops: stops.length, freshStops: freshStops.length },
    'coin watch intraday checked',
  );

  const text = formatCoinWatchIntraday(fresh, closedDay);
  if (text) {
    let delivered = 0;
    for (const chatId of chatIds) if ((await ctx.notifier.send(chatId, text)).ok) delivered += 1;
    ctx.logger.info({ delivered, chats: chatIds.length }, 'coin watch intraday alert sent');
  }

  // The web journal has no chat of its own; its trades go to the alert chats.
  const byChat = new Map<string, StopFinding[]>();
  for (const f of freshStops) {
    for (const chatId of f.trade.chatId === 'web' ? chatIds : [f.trade.chatId]) byChat.set(chatId, [...(byChat.get(chatId) ?? []), f]);
  }
  for (const [chatId, list] of byChat) {
    const stopText = formatStopAlert(list);
    if (stopText && (await ctx.notifier.send(chatId, stopText)).ok) ctx.logger.info({ chatId, trades: list.length }, 'journal stop alert sent');
  }
}
