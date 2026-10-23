import {
  getAllAlertSubscribers,
  getBotSettings,
  getOpenTradeSetups,
  getTrendStates,
  insertTradeSetup,
  resolveTradeSetup,
  type BtcTrend,
  type SetupCohort,
  type SetupContext,
  type TradeSetupRow,
} from '@crypto-signal/db';
import { detectSetups, resolveSetupOutcome, type MarketStructure, type OhlcvBar } from '@crypto-signal/indicators';
import { DEFAULT_RISK_PCT, formatPositionSize, positionSize, type RiskProfile } from '@crypto-signal/shared';
import type { WorkerContext } from './context.js';
import type { DailyBarSource } from './dailyBars.js';
import { COIN_FLOW_LABEL } from './coinDigest.js';

const DAY_MS = 86_400_000;

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const price = (n: number): string =>
  n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(5).replace(/\.?0+$/, '');

/** 4H bars read per scan: 20 days, enough for ATR, the volume baseline, and resolving any setup still open. */
const SETUP_BARS_4H = 120;
/** A setup that has hit neither level in two weeks is closed at the last price — it has stopped being the trade it was. */
const SETUP_EXPIRY_MS = 14 * DAY_MS;

export interface SetupScanOptions {
  cohort: SetupCohort;
  /** What put a scanned coin in its cohort today; null for the core symbols. */
  context: SetupContext | null;
  /** Whether a new setup is pushed to Telegram. The baseline cohort never is. */
  alert: boolean;
  /** False to only resolve open setups — a coin that has left the scan keeps being judged, but nothing new is recorded on it. */
  detect?: boolean;
}

/**
 * Resolves the symbol's open setups on fresh 4H bars, then records (and
 * maybe alerts) any new one. Shared by the core symbols' trend cycle and
 * the scanned coins' cycle, so both cohorts go through the same detector
 * and the same outcome rules — the comparison between them depends on it.
 */
export async function scanSetups(
  ctx: WorkerContext,
  symbol: string,
  dailyBars: OhlcvBar[],
  structure: MarketStructure,
  now: number,
  exchange: DailyBarSource,
  fetch4h: (symbol: string, limit: number, now: number) => Promise<OhlcvBar[]>,
  opts: SetupScanOptions,
): Promise<void> {
  const bars4h = await fetch4h(symbol, SETUP_BARS_4H, now);
  if (bars4h.length === 0) return;

  // Resolve first, so a setup that already played out is never reported
  // alongside a fresh one as if both were live. Only setups found on this
  // same exchange: a stop is judged on the wicks of the venue it was priced
  // on, so a Binance setup waits for Binance bars (120 bars reach back 20
  // days, past the 14-day expiry, so the first touch is still found then).
  const open = (await getOpenTradeSetups(ctx.pool)).filter((s) => s.symbol === symbol && s.exchange === exchange);
  for (const setup of open) {
    const { outcome, at } = resolveSetupOutcome(setup, bars4h);
    if (outcome === 'target') await resolveTradeSetup(ctx.pool, setup.id, 'target', at ?? now, setup.rr);
    else if (outcome === 'stop') await resolveTradeSetup(ctx.pool, setup.id, 'stop', at ?? now, -1);
    else if (now - setup.barOpenTime > SETUP_EXPIRY_MS) {
      const lastClose = (bars4h[bars4h.length - 1] as OhlcvBar).close;
      await resolveTradeSetup(ctx.pool, setup.id, 'expired', now, (lastClose - setup.entry) / (setup.entry - setup.stop));
    }
  }

  if (opts.detect === false) return;
  const candidates = detectSetups({ structure, dailyBars, bars4h });
  if (candidates.length === 0) return;
  // BTC's daily trend goes on the row because the detector never reads it
  // and the stored trend is overwritten daily: written now or never. The
  // trend cycle upserts BTC before scanning any core symbol's setups.
  const btcTrend = await readBtcTrend(ctx);
  for (const candidate of candidates) {
    const row = await insertTradeSetup(ctx.pool, { symbol, ...candidate, exchange, cohort: opts.cohort, context: opts.context, btcTrend });
    if (!row) continue; // already found on an earlier hourly run of this bar
    ctx.logger.info({ symbol, cohort: row.cohort, kind: row.kind, entry: row.entry, stop: row.stop, target: row.target, rr: row.rr }, 'setup found');
    if (opts.alert) await alertSetup(ctx, row);
  }
}

/** Null when the trend cycle has not stored BTC yet or the read fails: the setup is still recorded, just left out of the BTC comparison. */
async function readBtcTrend(ctx: WorkerContext): Promise<BtcTrend | null> {
  try {
    return (await getTrendStates(ctx.pool)).find((t) => t.symbol === 'BTCUSDT')?.trend ?? null;
  } catch (err) {
    ctx.logger.warn({ err }, 'could not read BTC trend for a setup');
    return null;
  }
}

/**
 * The alert chats and each one's /risk account, for anything sized per chat
 * (the setup alert, the digest's "Của bạn" section).
 *
 * An operator chat from TELEGRAM_ALERT_CHAT_IDS is not in the subscriber
 * list when it has /alerts off, so its settings are read on their own; one
 * that never talked to the bot has none and its profile is null.
 */
export async function alertChatsWithProfiles(ctx: WorkerContext): Promise<{ chatIds: string[]; profileOf: (chatId: string) => RiskProfile | null }> {
  const subscribers = await getAllAlertSubscribers(ctx.pool);
  const chatIds = Array.from(new Set([...ctx.config.telegramAlertChatIds, ...subscribers.map((s) => s.chatId)]));
  const settings = new Map(subscribers.map((s) => [s.chatId, s] as const));
  for (const chatId of ctx.config.telegramAlertChatIds) {
    if (!settings.has(chatId)) {
      const own = await getBotSettings(ctx.pool, chatId);
      if (own) settings.set(chatId, own);
    }
  }
  const profileOf = (chatId: string): RiskProfile | null => {
    const s = settings.get(chatId);
    return s && s.accountUsd !== null ? { accountUsd: s.accountUsd, riskPct: s.riskPct } : null;
  };
  return { chatIds, profileOf };
}

async function alertSetup(ctx: WorkerContext, setup: TradeSetupRow): Promise<void> {
  // Sized per chat, so each reader sees the position for their own account;
  // a chat without one gets the example size.
  const { chatIds, profileOf } = await alertChatsWithProfiles(ctx);
  for (const chatId of chatIds) await ctx.notifier.send(chatId, formatSetupAlert(setup, profileOf(chatId)));
}

const SETUP_TITLE: Record<TradeSetupRow['kind'], string> = {
  pullback: 'Hồi về hỗ trợ',
  breakout_retest: 'Phá vùng rồi test lại',
};

/** The size shown when a chat has not set its account: the guide's 1% rule on a round 1,000$. */
const EXAMPLE_PROFILE: RiskProfile = { accountUsd: 1000, riskPct: DEFAULT_RISK_PCT };

/**
 * One setup as a plan someone could act on — or decide not to. Pure for
 * testing. `profile` is the reading chat's own account (/risk); without
 * one the size is the example, labelled as such.
 */
export function formatSetupAlert(setup: TradeSetupRow, profile: RiskProfile | null = null): string {
  const risk = setup.entry - setup.stop;
  const asset = escapeHtml(setup.symbol.replace(/USDT$/, ''));
  const sizing = profile ?? EXAMPLE_PROFILE;
  const sizeLines = formatPositionSize(positionSize(sizing, 'long', setup.entry, setup.stop), sizing, asset, { example: profile === null });
  const lines = [
    `🎯 <b>${escapeHtml(setup.symbol)} 4H — ${SETUP_TITLE[setup.kind]}</b>${setup.cohort === 'watchlist' ? ' · ⭐ coin mạnh' : ''}`,
    ...(setup.cohort === 'watchlist' && setup.context ? [watchlistLine(setup.context)] : []),
    '',
    `Vào ~${price(setup.entry)} · Cắt lỗ ${price(setup.stop)} · Chốt lời ${price(setup.target)}`,
    `R:R 1:${setup.rr.toFixed(1)} · Rủi ro ${((risk / setup.entry) * 100).toFixed(1)}%/coin`,
    ...sizeLines,
    ...(profile ? [] : ['<i>/risk VỐN %RỦI_RO để tính theo tài khoản của bro.</i>']),
    '',
    ...setup.reasons.slice(0, -1).map((r) => `• ${escapeHtml(r)}`),
    ...(setup.btcTrend === 'down' && setup.symbol !== 'BTCUSDT'
      ? ['• <b>BTC 1D đang giảm</b> — bộ tìm setup không xét BTC; setup lúc BTC giảm đang được thống kê riêng trên trang Setup 4H.']
      : []),
    '',
    ...(setup.exchange === 'okx' ? ['<i>Nến 4H/1D lấy từ OKX vì Binance đang chặn IP máy chủ — giá trên Binance có thể lệch rất ít.</i>'] : []),
    ...(setup.cohort === 'watchlist'
      ? ['<i>Setup trên coin mạnh đang được kiểm chứng (so với cùng loại setup trên các coin khác trong top). Chỉ theo dõi, chưa nên vào tiền thật cho đến khi trang Setup 4H đủ mẫu để kết luận.</i>']
      : []),
    '<i>Ứng viên, không phải lệnh: tự xem chart và xu hướng BTC trước khi vào. Đặt cắt lỗ lên sàn ngay khi vào.</i>',
  ];
  return lines.join('\n');
}

function watchlistLine(context: SetupContext): string {
  const rs = context.rs30d === null ? '' : ` ${context.rs30d >= 0 ? '+' : ''}${context.rs30d.toFixed(0)}% so với BTC trong 30 ngày,`;
  const flow = COIN_FLOW_LABEL[context.flow as keyof typeof COIN_FLOW_LABEL] ?? context.flow;
  return `Trong danh sách theo dõi (quét ${escapeHtml(context.scanDay)}):${rs} dòng tiền 7N: ${escapeHtml(flow)}`;
}
