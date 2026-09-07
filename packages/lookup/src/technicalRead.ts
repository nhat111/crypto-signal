import {
  atrPctSeries,
  changePctOver,
  computeAtr,
  computeAtrPct,
  computeRsi,
  computeTrueRange,
  findSwingLevels,
  percentileOf,
  rangePosition,
  readTrend,
  rsiSeries,
  volumeVsAverage,
  windowExtremes,
  type OhlcvBar,
  type TrendDirection,
  type WindowExtreme,
} from '@crypto-signal/indicators';

/**
 * A description of where price sits, assembled from OHLCV alone.
 *
 * Every field is a fact about the recent past. None of them is a forecast,
 * and the wording downstream must not turn them into one: "RSI 72" is
 * measurable, "RSI 72 so it will fall" is a claim this codebase has no
 * recorded outcomes for — and the rule everywhere else here is that a
 * claim without recorded outcomes does not get made.
 *
 * Anything the history is too short to support comes back null and is
 * named in `missing`, because a blank field and a field that could not be
 * computed look identical to a reader otherwise.
 */
/** A level, with the two things that make it usable: how far, and in which direction. */
export interface LevelRead {
  price: number;
  distancePct: number;
}

export interface TechnicalRead {
  barCount: number;
  lastPrice: number;
  rsi14: number | null;
  /**
   * Where that RSI sits against this instrument's own last `barCount` bars.
   *
   * The number alone is generic — 75.7 means nothing without knowing
   * whether this thing lives at 70 or has not been above 60 in months.
   */
  rsi14Percentile: number | null;
  trend: { direction: TrendDirection; separationPct: number } | null;
  atrPct: number | null;
  atrPctPercentile: number | null;
  support: LevelRead | null;
  resistance: LevelRead | null;
  /** True when price is above every swing high in the window — the reason `resistance` is null. */
  aboveAllSwingHighs: boolean;
  belowAllSwingLows: boolean;
  /** 0 = bottom of the window's range, 100 = top. */
  rangePositionPct: number | null;
  windowHigh: WindowExtreme | null;
  windowLow: WindowExtreme | null;
  /** Latest bar's volume against the 20 before it. 1 is ordinary. */
  volumeRatio: number | null;
  changePct: { last24Bars: number | null; last7Bars: number | null };
  /** Which readings the history was too short for, in plain words. */
  missing: string[];
}

/** Below this, nothing but the last price is worth reporting. */
export const MIN_BARS_FOR_READ = 15;

export function buildTechnicalRead(bars: OhlcvBar[]): TechnicalRead | null {
  if (bars.length === 0) return null;

  const closes = bars.map((b) => b.close);
  const lastPrice = closes[closes.length - 1] as number;
  const missing: string[] = [];

  const rsi14 = computeRsi(closes, 14);
  if (rsi14 === null) missing.push('RSI 14 (needs 15 bars)');

  const trend = readTrend(closes, 20, 50);
  if (trend === null) missing.push('EMA 20/50 trend (needs 50 bars)');

  // True ranges need the previous close, so the first bar contributes none.
  const trueRanges = bars.map((b, i) => computeTrueRange(b, i === 0 ? undefined : (bars[i - 1] as OhlcvBar).close));
  const atrPct = trueRanges.length >= 15 ? computeAtrPct(computeAtr(trueRanges.slice(-14)), lastPrice) : null;
  if (atrPct === null) missing.push('ATR% (needs 15 bars)');

  const levels = findSwingLevels(bars, lastPrice, 2);
  if (levels.pivotCount === 0) missing.push('Support/resistance (no swing has formed yet)');

  const volumeRatio = volumeVsAverage(bars, 20);
  if (volumeRatio === null) missing.push('Volume vs average (needs 21 bars)');

  const extremes = windowExtremes(bars, lastPrice);

  return {
    barCount: bars.length,
    lastPrice,
    rsi14,
    rsi14Percentile: rsi14 === null ? null : percentileOf(rsi14, rsiSeries(closes, 14)),
    trend: trend === null ? null : { direction: trend.direction, separationPct: trend.separationPct },
    atrPct,
    atrPctPercentile: atrPct === null ? null : percentileOf(atrPct, atrPctSeries(bars, 14)),
    support: toLevel(levels.support, lastPrice),
    resistance: toLevel(levels.resistance, lastPrice),
    // Distinguishes "price broke above everything" from "no swing has
    // formed" — a dash means both otherwise, and they are opposite facts.
    aboveAllSwingHighs: levels.pivotCount > 0 && levels.resistance === null,
    belowAllSwingLows: levels.pivotCount > 0 && levels.support === null,
    rangePositionPct: rangePosition(bars, lastPrice),
    windowHigh: extremes?.high ?? null,
    windowLow: extremes?.low ?? null,
    volumeRatio,
    changePct: { last24Bars: changePctOver(closes, 24), last7Bars: changePctOver(closes, 7) },
    missing,
  };
}

function toLevel(price: number | null, reference: number): LevelRead | null {
  if (price === null || reference <= 0) return null;
  // The distance is the usable half: "$2.16" is a number, "11% below" is
  // something a position size can be built from.
  return { price, distancePct: ((price - reference) / reference) * 100 };
}

/**
 * The same read in sentences, for the bot and the page header.
 *
 * Deliberately flat description. Where a phrase could be read as advice
 * it is worded as a measurement instead: "RSI 72 — above the conventional
 * 70" rather than "overbought, consider taking profit".
 */
export function describeTechnicalRead(read: TechnicalRead): string[] {
  const lines: string[] = [];

  if (read.trend) {
    const word =
      read.trend.direction === 'up' ? 'EMA20 above EMA50' : read.trend.direction === 'down' ? 'EMA20 below EMA50' : 'EMA20 and EMA50 sit on top of each other';
    lines.push(`Structure: ${word} (${read.trend.separationPct >= 0 ? '+' : ''}${read.trend.separationPct.toFixed(2)}%).`);
  }

  if (read.rsi14 !== null) {
    const context = read.rsi14Percentile === null ? '' : ` — higher than ${read.rsi14Percentile.toFixed(0)}% of the last ${read.barCount} bars`;
    lines.push(`RSI 14: ${read.rsi14.toFixed(1)}${context}.`);
  }

  if (read.atrPct !== null) {
    const context = read.atrPctPercentile === null ? '' : ` — wider than ${read.atrPctPercentile.toFixed(0)}% of the window`;
    lines.push(`Average range over 14 bars: ${read.atrPct.toFixed(2)}% of price${context}.`);
  }

  if (read.volumeRatio !== null) {
    lines.push(`Latest bar's volume: ${read.volumeRatio.toFixed(2)}× the previous 20 bars.`);
  }

  if (read.support !== null) lines.push(`Nearest swing low ${read.support.price} (${read.support.distancePct.toFixed(1)}%).`);
  if (read.resistance !== null) lines.push(`Nearest swing high ${read.resistance.price} (+${read.resistance.distancePct.toFixed(1)}%).`);
  if (read.aboveAllSwingHighs) lines.push('Price is above every swing high in the window.');
  if (read.belowAllSwingLows) lines.push('Price is below every swing low in the window.');

  if (read.rangePositionPct !== null) {
    lines.push(`Position inside the ${read.barCount}-bar range: ${read.rangePositionPct.toFixed(0)}/100.`);
  }

  return lines;
}
