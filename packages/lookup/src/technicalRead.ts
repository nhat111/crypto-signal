import {
  changePctOver,
  computeAtr,
  computeAtrPct,
  computeRsi,
  computeTrueRange,
  findSwingLevels,
  rangePosition,
  readTrend,
  type OhlcvBar,
  type TrendDirection,
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
export interface TechnicalRead {
  barCount: number;
  lastPrice: number;
  rsi14: number | null;
  trend: { direction: TrendDirection; separationPct: number } | null;
  atrPct: number | null;
  support: number | null;
  resistance: number | null;
  /** 0 = bottom of the window's range, 100 = top. */
  rangePositionPct: number | null;
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

  return {
    barCount: bars.length,
    lastPrice,
    rsi14,
    trend: trend === null ? null : { direction: trend.direction, separationPct: trend.separationPct },
    atrPct,
    support: levels.support,
    resistance: levels.resistance,
    rangePositionPct: rangePosition(bars, lastPrice),
    changePct: { last24Bars: changePctOver(closes, 24), last7Bars: changePctOver(closes, 7) },
    missing,
  };
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
    const note = read.rsi14 >= 70 ? ' — above the conventional 70' : read.rsi14 <= 30 ? ' — below the conventional 30' : '';
    lines.push(`RSI 14: ${read.rsi14.toFixed(1)}${note}.`);
  }

  if (read.atrPct !== null) {
    lines.push(`Average range over 14 bars: ${read.atrPct.toFixed(2)}% of the current price.`);
  }

  if (read.support !== null || read.resistance !== null) {
    const parts: string[] = [];
    if (read.support !== null) parts.push(`nearest low ${read.support}`);
    if (read.resistance !== null) parts.push(`nearest high ${read.resistance}`);
    lines.push(`Levels from swings already formed: ${parts.join(', ')}.`);
  }

  if (read.rangePositionPct !== null) {
    lines.push(`Position inside the ${read.barCount}-bar range: ${read.rangePositionPct.toFixed(0)}/100.`);
  }

  return lines;
}
