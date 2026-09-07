/**
 * Classic price-structure indicators, for describing a chart the collector
 * has never seen.
 *
 * The rest of this package reads the live pipeline: CVD from counted
 * taker trades, open interest, funding, liquidations. None of that exists
 * for a symbol nobody is subscribed to, and none of it exists at all for a
 * token that only trades on a DEX. What DOES exist for anything with a
 * price history is OHLCV, so this module computes what OHLCV alone can
 * honestly support.
 *
 * Two rules run through all of it:
 *
 * - **Not enough history returns null, never a number.** An RSI computed
 *   from six candles is not a weak RSI, it is not an RSI, and a caller
 *   that sees 46 has no way to tell the difference.
 * - **Nothing here predicts.** These are descriptions of where price sits
 *   relative to its own recent history. "RSI is 72" is a fact; "RSI is 72
 *   so it will fall" is not something this codebase says anywhere else and
 *   will not start saying here.
 */

export interface OhlcvBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Exponential moving average of the last `period` values.
 *
 * Seeded with the simple average of the first `period` points rather than
 * with the first point alone: seeding on one value lets a single outlier
 * at the start of the window bias every subsequent reading, and the window
 * a caller passes is arbitrary.
 */
export function computeEma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;

  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);
  let ema = seed;
  for (let i = period; i < values.length; i += 1) {
    ema = (values[i] as number) * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Wilder's RSI over `period` closes.
 *
 * Wilder's smoothing, not a simple average of gains and losses — the two
 * give visibly different numbers and every chart the reader will compare
 * this against uses Wilder's.
 *
 * Needs period + 1 closes, because the first close only produces a
 * starting point, not a change.
 */
export function computeRsi(closes: number[], period = 14): number | null {
  if (period <= 0 || closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = (closes[i] as number) - (closes[i - 1] as number);
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = (closes[i] as number) - (closes[i - 1] as number);
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  // No losses at all in the window is a real state, not a divide-by-zero:
  // RSI is 100 by definition, and returning null would hide a genuine
  // one-directional run.
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type TrendDirection = 'up' | 'down' | 'sideways';

export interface TrendRead {
  direction: TrendDirection;
  fastEma: number;
  slowEma: number;
  /** How far apart the two averages sit, as a percentage of the slow one. */
  separationPct: number;
}

/**
 * Trend from two moving averages, with a deadband.
 *
 * The deadband is the point: without it, two averages a hundredth of a
 * percent apart read as a trend, and the label flips on noise. Anything
 * inside it is called sideways, which is usually the truth.
 */
export const TREND_DEADBAND_PCT = 0.5;

export function readTrend(closes: number[], fastPeriod = 20, slowPeriod = 50): TrendRead | null {
  const fast = computeEma(closes, fastPeriod);
  const slow = computeEma(closes, slowPeriod);
  if (fast === null || slow === null || slow === 0) return null;

  const separationPct = ((fast - slow) / Math.abs(slow)) * 100;
  const direction: TrendDirection =
    separationPct > TREND_DEADBAND_PCT ? 'up' : separationPct < -TREND_DEADBAND_PCT ? 'down' : 'sideways';
  return { direction, fastEma: fast, slowEma: slow, separationPct };
}

export interface SwingLevels {
  /** Nearest pivot high above the reference price. Null when price is above every one of them. */
  resistance: number | null;
  /** Nearest pivot low below it. Null when price is below every one. */
  support: number | null;
  /** How many pivots were found at all — a level drawn from two candles is not a level. */
  pivotCount: number;
}

/**
 * Support and resistance from fractal pivots.
 *
 * A pivot high is a bar whose high exceeds the `width` bars on both sides;
 * a pivot low is the mirror. It is the plainest definition there is, which
 * is the point — a level a reader can re-derive by eye from the same chart
 * is worth more than a cleverer one they have to take on trust.
 *
 * Returns the NEAREST level on each side of the reference price, because
 * the far ones are not what a decision turns on.
 */
export function findSwingLevels(bars: OhlcvBar[], reference: number, width = 2): SwingLevels {
  const highs: number[] = [];
  const lows: number[] = [];

  for (let i = width; i < bars.length - width; i += 1) {
    const bar = bars[i] as OhlcvBar;
    let isHigh = true;
    let isLow = true;
    for (let j = i - width; j <= i + width; j += 1) {
      if (j === i) continue;
      const other = bars[j] as OhlcvBar;
      if (other.high >= bar.high) isHigh = false;
      if (other.low <= bar.low) isLow = false;
    }
    if (isHigh) highs.push(bar.high);
    if (isLow) lows.push(bar.low);
  }

  const above = highs.filter((h) => h > reference).sort((a, b) => a - b);
  const below = lows.filter((l) => l < reference).sort((a, b) => b - a);

  return {
    resistance: above[0] ?? null,
    support: below[0] ?? null,
    pivotCount: highs.length + lows.length,
  };
}

/** Percentage change between the first and last close of the window. Null when the window is too short or starts at zero. */
export function changePctOver(closes: number[], bars: number): number | null {
  if (bars <= 0 || closes.length < bars + 1) return null;
  const from = closes[closes.length - 1 - bars] as number;
  const to = closes[closes.length - 1] as number;
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/**
 * Where price sits inside its own range over the window, 0-100.
 *
 * 0 is the bottom of the range, 100 the top. Says nothing about direction
 * — a token at 95 may be breaking out or about to be rejected — which is
 * exactly why it is reported as a position rather than a signal.
 */
export function rangePosition(bars: OhlcvBar[], reference: number): number | null {
  if (bars.length === 0) return null;
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  if (high === low) return null;
  const clamped = Math.min(Math.max(reference, low), high);
  return ((clamped - low) / (high - low)) * 100;
}

/**
 * The same indicator at every bar, so a reading can be placed against its
 * own history.
 *
 * "RSI is 75.7" is a fact nobody can act on without knowing whether 75.7
 * is unusual for this instrument. A number beside its own distribution
 * stops being generic: "higher than 94% of the last 200 bars" says
 * something 75.7 alone does not.
 *
 * The first `period` bars have no reading and are omitted rather than
 * zero-filled — padding would drag every percentile toward the bottom.
 */
export function rsiSeries(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];

  const out: number[] = [];
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = (closes[i] as number) - (closes[i - 1] as number);
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out.push(rsiFrom(avgGain, avgLoss));

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = (closes[i] as number) - (closes[i - 1] as number);
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out.push(rsiFrom(avgGain, avgLoss));
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** ATR as a percentage of close, at every bar that has `period` ranges behind it. */
export function atrPctSeries(bars: OhlcvBar[], period = 14): number[] {
  if (bars.length < period + 1) return [];

  const ranges: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    ranges.push(computeTrueRangeFor(bars[i] as OhlcvBar, (bars[i - 1] as OhlcvBar).close));
  }

  const out: number[] = [];
  for (let i = period - 1; i < ranges.length; i += 1) {
    const window = ranges.slice(i - period + 1, i + 1);
    const atr = window.reduce((a, b) => a + b, 0) / period;
    const close = (bars[i + 1] as OhlcvBar).close;
    out.push(close === 0 ? 0 : (atr / close) * 100);
  }
  return out;
}

function computeTrueRangeFor(bar: OhlcvBar, previousClose: number): number {
  return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
}

/**
 * How much of `series` sits at or below `value`, 0-100.
 *
 * Null for an empty series rather than 50: "we have no history to compare
 * against" and "this is exactly average" are different answers, and only
 * one of them is a measurement.
 */
export function percentileOf(value: number, series: number[]): number | null {
  if (series.length === 0) return null;
  const atOrBelow = series.filter((v) => v <= value).length;
  return (atOrBelow / series.length) * 100;
}

export interface WindowExtreme {
  price: number;
  /** How many bars back it happened — "3 bars ago" and "180 bars ago" are different facts. */
  barsAgo: number;
  /** Percentage distance from the reference price to it. */
  distancePct: number;
}

/** Highest high and lowest low of the window, with when and how far. */
export function windowExtremes(
  bars: OhlcvBar[],
  reference: number,
): { high: WindowExtreme; low: WindowExtreme } | null {
  if (bars.length === 0 || reference <= 0) return null;

  let highIdx = 0;
  let lowIdx = 0;
  for (let i = 1; i < bars.length; i += 1) {
    if ((bars[i] as OhlcvBar).high > (bars[highIdx] as OhlcvBar).high) highIdx = i;
    if ((bars[i] as OhlcvBar).low < (bars[lowIdx] as OhlcvBar).low) lowIdx = i;
  }

  const last = bars.length - 1;
  const high = (bars[highIdx] as OhlcvBar).high;
  const low = (bars[lowIdx] as OhlcvBar).low;
  return {
    high: { price: high, barsAgo: last - highIdx, distancePct: ((high - reference) / reference) * 100 },
    low: { price: low, barsAgo: last - lowIdx, distancePct: ((low - reference) / reference) * 100 },
  };
}

/**
 * Latest volume against the average of the bars before it.
 *
 * The latest bar is excluded from its own baseline: including it pulls the
 * average toward whatever just happened, which is exactly the thing being
 * measured.
 */
export function volumeVsAverage(bars: OhlcvBar[], lookback = 20): number | null {
  if (bars.length < lookback + 1) return null;
  const recent = bars.slice(-(lookback + 1), -1);
  const average = recent.reduce((sum, b) => sum + b.volume, 0) / recent.length;
  if (average <= 0) return null;
  return (bars[bars.length - 1] as OhlcvBar).volume / average;
}
