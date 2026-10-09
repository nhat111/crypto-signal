import { findPivots, type MarketStructure } from './structure.js';
import type { OhlcvBar } from './technicals.js';

/**
 * The two setups the TA guide teaches, found mechanically on CLOSED 4H bars
 * under the 1D structure — and turned into the guide's three numbers
 * (entry, stop, target) before anyone is told about them.
 *
 * - **pullback**: 1D up and above its EMA, the last 4H bar dipped to within
 *   one ATR of the latest 1D swing low, and was rejected there — a long
 *   lower wick, closed in the upper part of its range, back above the level.
 * - **breakout_retest**: 1D not down and above its EMA, a 4H close above
 *   the latest 1D swing high on at least 1.5× the prior 20-bar average
 *   volume, and now a bar that came back to that level and closed above it.
 *
 * The stop goes under the level, not inside it (the guide's Ví dụ 1 is
 * about exactly that mistake). The target is the nearest 1D swing high
 * above entry; with none above there is no target and so no setup — a
 * made-up target would make up the R:R too. Anything under the minimum
 * R:R is dropped, which is the guide's Ví dụ 3.
 *
 * A candidate, not an instruction: nothing here knows the news, the
 * user's account, or BTC.
 */

export type SetupKind = 'pullback' | 'breakout_retest';

export interface SetupCandidate {
  kind: SetupKind;
  /** Open time of the 4H bar that completed the setup — the dedupe key with symbol and kind. */
  barOpenTime: number;
  /** The 1D level the setup is built on: the swing low for a pullback, the broken swing high for a retest. */
  level: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  atr: number;
  reasons: string[];
}

export interface DetectSetupsInput {
  structure: MarketStructure;
  /** The daily bars the structure was read from, for finding the next resistance above entry. */
  dailyBars: OhlcvBar[];
  /** Closed 4H bars, oldest first. */
  bars4h: OhlcvBar[];
  minRr?: number;
}

const ATR_PERIOD = 14;
const VOLUME_LOOKBACK = 20;
const VOLUME_MULT = 1.5;
/** How far back a breakout may be and still be "retested" now: 18 × 4H = 3 days. */
const BREAKOUT_WINDOW = 18;

export function averageTrueRange(bars: OhlcvBar[], period = ATR_PERIOD): number | null {
  if (bars.length < period + 1) return null;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i += 1) {
    const bar = bars[i] as OhlcvBar;
    const prevClose = (bars[i - 1] as OhlcvBar).close;
    sum += Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  }
  return sum / period;
}

/** Long lower wick, closed in the upper part of the bar: price went down there and was pushed back. */
export function isRejection(bar: OhlcvBar): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  return lowerWick / range >= 0.3 && (bar.close - bar.low) / range >= 0.55;
}

const fmt = (n: number): string =>
  n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(5).replace(/\.?0+$/, '');

/**
 * The guide's target: the 1D resistance above — the structure's own latest
 * swing high when price is under it, otherwise the next daily pivot high
 * above price. Not simply the nearest pivot of any size: replayed on real
 * data that picked minor wiggles a fraction of the risk away (an ETH
 * pullback "targeting" 0.3% above entry), which made every plan fail the
 * R:R gate for a reason the guide would never draw.
 */
function nextResistanceAbove(dailyBars: OhlcvBar[], structuralHigh: number | undefined, price: number): number | null {
  if (structuralHigh !== undefined && structuralHigh > price) return structuralHigh;
  const above = findPivots(dailyBars, 3)
    .highs.map((h) => h.price)
    .filter((p) => p > price)
    .sort((a, b) => a - b);
  return above[0] ?? null;
}

export function detectSetups(input: DetectSetupsInput): SetupCandidate[] {
  const { structure, dailyBars, bars4h } = input;
  const minRr = input.minRr ?? 2;
  const last = bars4h[bars4h.length - 1];
  const atr = averageTrueRange(bars4h);
  if (!last || atr === null || atr <= 0 || structure.aboveEma !== true) return [];

  const out: SetupCandidate[] = [];
  const support = structure.swingLows[structure.swingLows.length - 1]?.price;
  const resistance = structure.swingHighs[structure.swingHighs.length - 1]?.price;

  const finish = (kind: SetupKind, level: number, stop: number, reasons: string[]): void => {
    const entry = last.close;
    // For a retest the broken high is now support, so it cannot be the target.
    const target = nextResistanceAbove(dailyBars, kind === 'pullback' ? resistance : undefined, entry);
    if (target === null || stop >= entry) return;
    const rr = (target - entry) / (entry - stop);
    if (rr < minRr) return;
    out.push({
      kind,
      barOpenTime: last.openTime,
      level,
      entry,
      stop,
      target,
      rr,
      atr,
      reasons: [
        ...reasons,
        `Kế hoạch: vào ~${fmt(entry)}, cắt lỗ ${fmt(stop)} (dưới vùng), chốt lời ${fmt(target)} (đỉnh 1D kế tiếp) — R:R 1:${rr.toFixed(1)}.`,
      ],
    });
  };

  // Pullback to the latest 1D swing low. The zone is the wider of one 4H
  // ATR and half a daily ATR: a 1D level is a daily-sized thing, and a
  // 4H-sized band around it missed most real touches when replayed on
  // five months of BTC/ETH/SOL. The touch may be the last bar or the one
  // before — the rejection often finishes on the bar after the wick.
  const dailyAtr = averageTrueRange(dailyBars) ?? 0;
  const zone = Math.max(atr, 0.5 * dailyAtr);
  const prevBar = bars4h[bars4h.length - 2];
  if (structure.trend === 'up' && support !== undefined) {
    const touchedLow = Math.min(last.low, prevBar?.low ?? last.low);
    const dipped = touchedLow <= support + zone && touchedLow >= support - zone;
    const rejected = isRejection(last) || (prevBar !== undefined && isRejection(prevBar) && last.close > last.open);
    if (dipped && last.close > support && rejected) {
      finish('pullback', support, Math.min(support, touchedLow) - 0.5 * atr, [
        `1D đang tăng và trên EMA${structure.emaPeriod}.`,
        `Giá 4H vừa chạm ${fmt(touchedLow)}, sát đáy 1D gần nhất ${fmt(support)}, rồi bị đẩy lên — râu dưới dài, đóng ${fmt(last.close)}.`,
      ]);
    }
  }

  // Breakout above the latest 1D swing high, now retested.
  if (structure.trend !== 'down' && resistance !== undefined) {
    const n = bars4h.length;
    for (let b = Math.max(VOLUME_LOOKBACK + 1, n - 1 - BREAKOUT_WINDOW); b < n - 1; b += 1) {
      const bar = bars4h[b] as OhlcvBar;
      const prev = bars4h[b - 1] as OhlcvBar;
      if (!(bar.close > resistance && prev.close <= resistance)) continue;
      const window = bars4h.slice(b - VOLUME_LOOKBACK, b);
      const avgVol = window.reduce((s, x) => s + x.volume, 0) / window.length;
      if (avgVol <= 0 || bar.volume < VOLUME_MULT * avgVol) continue;
      // Every bar since the breakout must have held above the level on its
      // close — a close back inside the old range is a failed breakout,
      // not something to retest.
      const held = bars4h.slice(b + 1, n).every((x) => x.close > resistance);
      const retest = last.low <= resistance + 0.5 * atr && last.close > resistance && last.close > last.open;
      if (held && retest) {
        finish('breakout_retest', resistance, Math.min(resistance - atr, last.low - 0.5 * atr), [
          `1D trên EMA${structure.emaPeriod}, không trong xu hướng giảm.`,
          `Nến 4H đã đóng trên đỉnh 1D ${fmt(resistance)} với khối lượng gấp ${(bar.volume / avgVol).toFixed(1)} lần trung bình 20 nến.`,
          `Giá vừa quay lại test vùng ${fmt(resistance)} và đóng trên nó (${fmt(last.close)}).`,
        ]);
      }
      break;
    }
  }

  return out;
}

export type SetupOutcome = 'target' | 'stop' | 'open';

/**
 * Which level the bars AFTER the setup touched first. A bar that touched
 * both is scored as the stop: inside one 4H bar the order is unknowable,
 * and the conservative reading is the one that does not flatter the scanner.
 */
export function resolveSetupOutcome(setup: { stop: number; target: number; barOpenTime: number }, barsAfter: OhlcvBar[]): { outcome: SetupOutcome; at: number | null } {
  for (const bar of barsAfter) {
    if (bar.openTime <= setup.barOpenTime) continue;
    if (bar.low <= setup.stop) return { outcome: 'stop', at: bar.openTime };
    if (bar.high >= setup.target) return { outcome: 'target', at: bar.openTime };
  }
  return { outcome: 'open', at: null };
}
