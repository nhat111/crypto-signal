import { computeEma, type OhlcvBar } from './technicals.js';

/**
 * Trend as market structure, read the way the TA guide teaches it.
 *
 * `readTrend` in technicals.ts compares two moving averages, which answers
 * "which way have closes leaned lately". This answers the question a spot
 * buyer actually asks of a daily chart: are the highs and lows still
 * stepping up, and has the last higher low been lost?
 *
 * - Up: the last two confirmed swing highs AND the last two swing lows
 *   are each higher than the one before.
 * - Down: both lower.
 * - Anything else is sideways — including a lower high under rising lows,
 *   which the guide calls the warning, not yet the verdict.
 * - The verdict is a CLOSE beyond the latest swing on the wrong side: an
 *   up structure whose last close sits below its latest swing low is
 *   broken, whatever the pivots still say. Wicks do not count; only
 *   closed bars are passed in.
 *
 * Deliberately no prediction. "Broken" is a description of the last close
 * relative to a level anyone can find on the same chart.
 */

export type StructureTrend = 'up' | 'down' | 'sideways';

/** What changed the label on the latest close, if anything did. */
export type StructureEvent = 'up_broken' | 'down_broken' | null;

export interface SwingPoint {
  openTime: number;
  price: number;
}

export interface MarketStructure {
  trend: StructureTrend;
  event: StructureEvent;
  /** Up to the last two confirmed pivots on each side, oldest first. */
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  lastClose: number;
  lastCloseTime: number;
  /** Null when there are fewer bars than the period — 150 days is not an EMA200. */
  ema: number | null;
  emaPeriod: number;
  aboveEma: boolean | null;
  /** Plain-language reasons, in Vietnamese, for the bot and the web. */
  reasons: string[];
}

export interface ReadStructureOptions {
  /**
   * Bars on each side a pivot must beat. 3 by default: measured on 400 days
   * of BTC/ETH/SOL, width 2 flipped the label 19–39 times in 120 days —
   * week-scale wiggles, not the daily structure a spot holder acts on —
   * and width 3 cut that to 13–26 while still catching every break the
   * wider setting caught.
   */
  width?: number;
  emaPeriod?: number;
}

/** Fewer pivots than this on either side and there is no structure to read. */
const MIN_SWINGS = 2;

export function findPivots(bars: OhlcvBar[], width: number): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = width; i < bars.length - width; i += 1) {
    const bar = bars[i] as OhlcvBar;
    let isHigh = true;
    let isLow = true;
    for (let j = i - width; j <= i + width; j += 1) {
      if (j === i) continue;
      const other = bars[j] as OhlcvBar;
      // Strict on the left, inclusive on the right: two bars printing the
      // same high are one swing, credited to the first. Strict on both
      // sides would make a flat double top no swing at all — and a double
      // top is exactly the swing a reader draws.
      if (j < i ? other.high >= bar.high : other.high > bar.high) isHigh = false;
      if (j < i ? other.low <= bar.low : other.low < bar.low) isLow = false;
    }
    if (isHigh) highs.push({ openTime: bar.openTime, price: bar.high });
    if (isLow) lows.push({ openTime: bar.openTime, price: bar.low });
  }
  return { highs, lows };
}

const fmt = (n: number): string =>
  n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(5).replace(/\.?0+$/, '');

/**
 * Reads structure from CLOSED bars, oldest first. Returns null when there
 * is not enough history to find two swings on each side.
 */
export function readMarketStructure(bars: OhlcvBar[], opts: ReadStructureOptions = {}): MarketStructure | null {
  const width = opts.width ?? 3;
  const emaPeriod = opts.emaPeriod ?? 200;
  const last = bars[bars.length - 1];
  if (!last) return null;

  const { highs, lows } = findPivots(bars, width);
  if (highs.length < MIN_SWINGS || lows.length < MIN_SWINGS) return null;

  const [h1, h2] = highs.slice(-2) as [SwingPoint, SwingPoint];
  const [l1, l2] = lows.slice(-2) as [SwingPoint, SwingPoint];
  const higherHigh = h2.price > h1.price;
  const higherLow = l2.price > l1.price;

  const structural: StructureTrend = higherHigh && higherLow ? 'up' : !higherHigh && !higherLow ? 'down' : 'sideways';

  const reasons: string[] = [];
  reasons.push(
    `Đỉnh gần nhất ${fmt(h2.price)} ${higherHigh ? 'cao hơn' : 'thấp hơn'} đỉnh trước ${fmt(h1.price)}; ` +
      `đáy gần nhất ${fmt(l2.price)} ${higherLow ? 'cao hơn' : 'thấp hơn'} đáy trước ${fmt(l1.price)}.`,
  );

  // The break is judged on the side that was holding the structure up (or
  // down), not on the label: the guide's sequence is a lower high first —
  // already "sideways" by the pivots — and THEN a close under the last
  // higher low. Waiting for a clean "up" label before looking for the
  // break would miss exactly the case the guide draws.
  let trend = structural;
  let event: StructureEvent = null;
  if (higherLow && last.close < l2.price) {
    trend = 'sideways';
    event = 'up_broken';
    reasons.push(`Giá đóng ${fmt(last.close)} dưới đáy gần nhất ${fmt(l2.price)} — chuỗi đáy cao dần đã gãy.`);
  } else if (!higherHigh && last.close > h2.price) {
    trend = 'sideways';
    event = 'down_broken';
    reasons.push(`Giá đóng ${fmt(last.close)} trên đỉnh gần nhất ${fmt(h2.price)} — chuỗi đỉnh thấp dần đã gãy.`);
  } else if (structural === 'sideways' && !higherHigh && higherLow) {
    reasons.push('Đỉnh thấp hơn trong khi đáy vẫn cao dần — cảnh báo lực mua yếu đi, chưa phải gãy.');
  }

  const ema = computeEma(
    bars.map((b) => b.close),
    emaPeriod,
  );
  const aboveEma = ema === null ? null : last.close > ema;
  if (ema !== null) {
    reasons.push(`Giá đóng ${aboveEma ? 'trên' : 'dưới'} EMA${emaPeriod} (${fmt(ema)}).`);
  }

  return {
    trend,
    event,
    swingHighs: [h1, h2],
    swingLows: [l1, l2],
    lastClose: last.close,
    lastCloseTime: last.openTime,
    ema,
    emaPeriod,
    aboveEma,
    reasons,
  };
}
