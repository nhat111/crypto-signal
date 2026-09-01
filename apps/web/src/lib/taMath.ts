/**
 * Indicator maths for the TA guide's figures.
 *
 * The lines in those figures are computed from the candles drawn beside
 * them, never sketched by hand. A hand-drawn EMA that does not match its
 * own candles teaches the reader to see a relationship that is not there,
 * which is worse than leaving the indicator out.
 *
 * Kept here rather than imported from `@crypto-signal/indicators` on
 * purpose: apps/web talks to the system over HTTP and owns its own types
 * (API_CONTRACT.md). `atr` below mirrors that package's definition — a
 * simple mean of true ranges, not Wilder smoothing — so the guide and the
 * engine cannot describe two different things by the same name.
 */

/** Exponential moving average. Null until `period` closes exist, because an average of three candles is not a 21-candle average. */
export function ema(closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length < period) return out;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += closes[i] as number;
  let prev = seed / period;
  out[period - 1] = prev;

  for (let i = period; i < closes.length; i += 1) {
    prev = (closes[i] as number) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's RSI. Null until there are `period` changes to average.
 *
 * A flat-to-rising stretch gives 100 and a falling one 0 — those are real
 * readings, not errors, and they are exactly the case the guide is written
 * against: an RSI pinned above 70 through a strong trend.
 */
export function rsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = (closes[i] as number) - (closes[i - 1] as number);
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = toRsi(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const change = (closes[i] as number) - (closes[i - 1] as number);
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export interface Bar {
  high: number;
  low: number;
  close: number;
}

/** True range: the day's span, widened to include a gap from the previous close. */
export function trueRange(bar: Bar, previousClose: number | undefined): number {
  if (previousClose === undefined) return bar.high - bar.low;
  return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
}

/** Mean true range over a trailing window. Null until the window is full. */
export function atr(bars: Bar[], period = 14): Array<number | null> {
  const ranges = bars.map((bar, i) => trueRange(bar, i === 0 ? undefined : (bars[i - 1] as Bar).close));
  return ranges.map((_, i) => {
    if (i + 1 < period) return null;
    const window = ranges.slice(i + 1 - period, i + 1);
    return window.reduce((a, b) => a + b, 0) / period;
  });
}
