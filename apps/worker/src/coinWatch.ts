import type { CoinScanRow } from '@crypto-signal/db';
import type { CoinFlow } from '@crypto-signal/indicators';
import type { CoinScanThresholds } from '@crypto-signal/shared';
import { COIN_FLOW_LABEL } from './coinDigest.js';

/**
 * The exit half of the coin workflow: the scan picks coins to watch and the
 * 4H detector finds entries, but nothing said when the reason to hold one
 * had gone. After each new scan day, the coins the user holds (open long or
 * spot trades) or watches (yesterday's ⭐) are compared with the day before,
 * and only changes that weaken the case for holding are reported.
 *
 * Like the digest, only two days read from the same exchange are compared:
 * a switch of venue is not news about the coin.
 */

/** Flows that, arrived at from any other, mean the move's support is going. */
const EXIT_FLOWS: readonly CoinFlow[] = ['short_covering', 'long_unwind', 'spot_selling', 'shorts_building', 'distribution'];

export interface WatchedCoin {
  held: boolean;
  starred: boolean;
}

export interface CoinWatchChange {
  symbol: string;
  watched: WatchedCoin;
  reasons: string[];
}

/**
 * Who is watched: the given ⭐ coins, and every open long or spot trade in
 * the journal. Shorts are left out: a coin weakening is good news for them.
 * `normalize` turns a hand-typed journal symbol into the scan's.
 */
export function watchedCoins(
  starred: ReadonlySet<string>,
  openTrades: ReadonlyArray<{ symbol: string; side: string }>,
  normalize: (raw: string) => string,
): Map<string, WatchedCoin> {
  const watched = new Map<string, WatchedCoin>();
  for (const s of starred) watched.set(s, { held: false, starred: true });
  for (const t of openTrades.filter((t) => t.side !== 'short')) {
    const symbol = normalize(t.symbol);
    watched.set(symbol, { held: true, starred: starred.has(symbol) });
  }
  return watched;
}

const pct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(4)}%`;

/** Pure: what changed for each watched coin between two scan days. Coins with nothing to report are left out. */
export function coinWatchChanges(
  today: CoinScanRow[],
  previous: CoinScanRow[],
  watched: Map<string, WatchedCoin>,
  todayWatchlist: ReadonlySet<string>,
  thresholds: CoinScanThresholds,
): CoinWatchChange[] {
  if (today.length === 0 || previous.length === 0 || today[0]?.exchange !== previous[0]?.exchange) return [];
  const before = new Map(previous.map((r) => [r.symbol, r]));
  const changes: CoinWatchChange[] = [];

  for (const now of today) {
    const who = watched.get(now.symbol);
    const was = before.get(now.symbol);
    if (!who || !was) continue;
    const reasons: string[] = [];

    if (EXIT_FLOWS.includes(now.flow) && was.flow !== now.flow) {
      reasons.push(`Nhãn đổi: ${COIN_FLOW_LABEL[was.flow] ?? was.flow} → ${COIN_FLOW_LABEL[now.flow] ?? now.flow}.`);
    }
    // The one label the replay found to lead anything (ASSUMPTIONS §28):
    // read on a second day running, the coin trailed the average coin over
    // the next two weeks. The first day alone did not, so it waits a day,
    // and it repeats while the squeeze lasts (about 1.6 more days on average).
    if (now.flow === 'short_squeeze' && was.flow === 'short_squeeze') {
      reasons.push(`${COIN_FLOW_LABEL.short_squeeze} từ 2 ngày trở lên: trong replay 2024–2026, coin như vậy 14 ngày sau kém coin trung bình khoảng 2,6% (đoạn cuối cú tăng).`);
    }
    if (was.fundingAvg7dPct !== null && was.fundingAvg7dPct <= thresholds.fundingShortsPayPct && now.fundingAvg7dPct !== null && now.fundingAvg7dPct > 0) {
      reasons.push(`Funding đổi từ âm sang dương (${pct(was.fundingAvg7dPct)} → ${pct(now.fundingAvg7dPct)}/8h): phe short đã rút, giờ là long đuổi giá.`);
    }
    if (was.rsAboveSma20 === true && now.rsAboveSma20 === false) {
      reasons.push('Tỉ giá với BTC rơi xuống dưới trung bình 20 ngày: đà mạnh hơn BTC đang yếu đi.');
    }
    if (who.starred && !todayWatchlist.has(now.symbol)) {
      reasons.push('Rớt khỏi danh sách ⭐.');
    }

    if (reasons.length > 0) changes.push({ symbol: now.symbol, watched: who, reasons });
  }

  // A watched coin read yesterday and missing today fell out of the volume
  // ranking: the attention that made it move has gone elsewhere.
  const present = new Set(today.map((r) => r.symbol));
  for (const [symbol, who] of watched) {
    if (present.has(symbol) || !before.has(symbol)) continue;
    changes.push({ symbol, watched: who, reasons: ['Rớt khỏi nhóm coin volume lớn nhất: dòng tiền đã nguội, hôm nay không còn được quét.'] });
  }
  // Held coins first: those are the ones with money on them.
  return changes.sort((a, b) => Number(b.watched.held) - Number(a.watched.held) || a.symbol.localeCompare(b.symbol));
}

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const dayVi = (day: string): string => day.split('-').reverse().slice(0, 2).join('/');

/** One message for the day's changes; null when there are none, so nothing is sent. */
export function formatCoinWatch(changes: CoinWatchChange[], day: string): string | null {
  if (changes.length === 0) return null;
  const lines = [`👀 <b>Coin đang theo dõi đổi trạng thái</b> (nến ${dayVi(day)})`];
  for (const c of changes) {
    const tags = [c.watched.held ? 'đang giữ' : null, c.watched.starred ? '⭐' : null].filter(Boolean).join(', ');
    lines.push('', `<b>${escapeHtml(c.symbol.replace(/USDT$/, ''))}</b> (${tags})`);
    for (const r of c.reasons) lines.push(`• ${escapeHtml(r)}`);
  }
  lines.push('', '<i>Mô tả 7–30 ngày đã qua, không phải lệnh bán. Đối chiếu với thesis và điều kiện bán đã ghi trong Journal.</i>', 'Chi tiết: /coins');
  return lines.join('\n');
}
