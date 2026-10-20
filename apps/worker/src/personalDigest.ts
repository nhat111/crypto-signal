import { computeTradePnl, type CoinScanRow, type TradeRow, type TradeSetupRow } from '@crypto-signal/db';
import { formatPositionSize, positionSize, type RiskProfile } from '@crypto-signal/shared';
import { COIN_FLOW_LABEL } from './coinDigest.js';

/**
 * The digest's "Của bạn" section: what the morning means for this one chat.
 * The rest of the digest is the same for everyone; this is the part the
 * reader would otherwise rebuild from /journal, /coins and /setups.
 *
 * The exit alert (coinWatch.ts) only speaks when a held coin turns against
 * holding it, so on a quiet day nothing said how the positions stood. This
 * says it every morning, in a few lines, without judging them.
 */

export interface PersonalDigestInput {
  /** This chat's open journal trades, newest first. */
  openTrades: TradeRow[];
  /** Last daily close per scan symbol (BATUSDT form), from the trend read and the coin scan. */
  prices: ReadonlyMap<string, number>;
  /** The day's scan and the one before, for the flow label and whether it changed. */
  today: CoinScanRow[];
  previous: CoinScanRow[];
  /** Open setups the chat could have been alerted on (core and ⭐, never the baseline cohort). */
  setups: TradeSetupRow[];
  /** The chat's /risk account, or null when it has not set one. */
  profile: RiskProfile | null;
}

const MAX_TRADES = 8;
const MAX_SETUPS = 3;

const SETUP_TITLE: Record<TradeSetupRow['kind'], string> = {
  pullback: 'Hồi về hỗ trợ',
  breakout_retest: 'Phá vùng rồi test lại',
};

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const price = (n: number): string =>
  n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(5).replace(/\.?0+$/, '');

const signedPct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const signedUsd = (n: number): string => `${n >= 0 ? '+' : '-'}${Math.abs(n) >= 100 ? Math.round(Math.abs(n)).toLocaleString('en-US') : Math.abs(n).toFixed(2)}$`;

/** A ticker reads as itself; a contract address is cut so the line stays one line. */
function displaySymbol(symbol: string): string {
  if (symbol.length > 16) return `${symbol.slice(0, 6)}…${symbol.slice(-4)}`;
  return symbol.replace(/USDT$/, '');
}

/**
 * Pure. `scanSymbolOf` maps a journal symbol to the scan's form
 * (coinScan.ts `scanSymbol`); passed in so this file stays free of the scan.
 */
export function formatPersonalDigest(input: PersonalDigestInput, scanSymbolOf: (raw: string) => string): string[] {
  const { openTrades, prices, today, previous, setups, profile } = input;
  const lines = ['👤 <b>Của bạn</b>'];

  if (openTrades.length === 0) {
    lines.push('Không có lệnh mở trong Journal (/trade để ghi).');
  } else {
    lines.push(`Đang giữ ${openTrades.length} lệnh (giá đóng nến ngày):`);
    // Flow labels only compare across the same exchange, as in the coin digest.
    const sameVenue = today.length > 0 && previous.length > 0 && today[0]?.exchange === previous[0]?.exchange;
    const todayBy = new Map(today.map((r) => [r.symbol, r]));
    const beforeBy = new Map(previous.map((r) => [r.symbol, r]));

    for (const t of openTrades.slice(0, MAX_TRADES)) {
      const symbol = scanSymbolOf(t.symbol);
      const head = `• <b>${escapeHtml(displaySymbol(t.symbol))}</b> ${t.side} · vào ${price(t.entryPrice)}`;
      const close = prices.get(symbol);
      if (close === undefined) {
        lines.push(`${head} · chưa có giá (ngoài bản quét)`);
        continue;
      }
      const pnl = computeTradePnl(t.side, t.entryPrice, close, t.size);
      const usd = pnl.pnlUsd === null ? '' : `, ${signedUsd(pnl.pnlUsd)}`;
      const row = todayBy.get(symbol);
      const was = sameVenue ? beforeBy.get(symbol) : undefined;
      const flow = row ? ` · ${COIN_FLOW_LABEL[row.flow] ?? row.flow}${was && was.flow !== row.flow ? ` (hôm qua: ${COIN_FLOW_LABEL[was.flow] ?? was.flow})` : ''}` : '';
      lines.push(`${head} → ${price(close)} (${signedPct(pnl.pnlPct)}${usd})${flow}`);
    }
    if (openTrades.length > MAX_TRADES) lines.push(`… và ${openTrades.length - MAX_TRADES} lệnh khác: /journal`);
  }

  if (setups.length > 0) {
    const recent = [...setups].sort((a, b) => b.detectedAt - a.detectedAt).slice(0, MAX_SETUPS);
    lines.push('', `Setup 4H còn mở: ${setups.length}${setups.length > MAX_SETUPS ? ` (${MAX_SETUPS} mới nhất)` : ''}`);
    for (const s of recent) {
      const asset = escapeHtml(s.symbol.replace(/USDT$/, ''));
      lines.push(`• <b>${asset}</b> ${SETUP_TITLE[s.kind]}${s.cohort === 'watchlist' ? ' ⭐' : ''} · vào ~${price(s.entry)} · cắt lỗ ${price(s.stop)} · chốt ${price(s.target)}`);
      if (profile) lines.push(...formatPositionSize(positionSize(profile, 'long', s.entry, s.stop), profile, asset).map((l) => `  ${l}`));
    }
    if (!profile) lines.push('<i>/risk VỐN %RỦI_RO để tính cỡ lệnh theo tài khoản của bro.</i>');
  }

  return lines;
}
