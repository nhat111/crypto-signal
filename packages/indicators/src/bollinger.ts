/**
 * Bollinger Bands — a reference price range, not a trade instruction (spec
 * §16/§38: reasons/levels are always explainable and probability-framed,
 * never a directive). Surfaced as "here's where price has recently ranged,"
 * the same spirit as the rest of the signal engine's `reasons` text.
 *
 * Deterministic and pure, like every other indicator here — same inputs
 * always produce the same bands, unit-testable without a network call.
 */

export interface BollingerBands {
  /** Upper band: middle + (multiplier × standard deviation). */
  upper: number;
  /** Simple moving average over the window. */
  middle: number;
  /** Lower band: middle − (multiplier × standard deviation). */
  lower: number;
}

const DEFAULT_PERIOD = 20;
const DEFAULT_STDDEV_MULTIPLIER = 2;

/**
 * `closes` must be ordered oldest→newest. Returns null when there isn't
 * yet a full period of history — a partial window would understate the
 * true range and mislead rather than just being absent.
 */
export function computeBollingerBands(
  closes: number[],
  period = DEFAULT_PERIOD,
  stdDevMultiplier = DEFAULT_STDDEV_MULTIPLIER,
): BollingerBands | null {
  if (closes.length < period) return null;

  const window = closes.slice(-period);
  const middle = window.reduce((sum, c) => sum + c, 0) / period;
  const variance = window.reduce((sum, c) => sum + (c - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + stdDevMultiplier * stdDev,
    middle,
    lower: middle - stdDevMultiplier * stdDev,
  };
}
