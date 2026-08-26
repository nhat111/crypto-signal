/**
 * Macro flow proxy: how fast total stablecoin supply is growing.
 *
 * Rising supply means fiat was converted into on-chain dollars — money
 * that has entered crypto but not yet chosen an asset. Falling supply
 * means the reverse. That is a *context* reading, on a daily cadence, and
 * deliberately never feeds the candle pipeline or the Health Score: it
 * cannot confirm a trend, and treating it as confirmation is exactly the
 * mistake this project's disclaimers exist to prevent.
 *
 * Pure and deterministic like every other indicator here — same points in,
 * same numbers out, unit-testable with no network.
 */

export interface StablecoinSupplyPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  totalCirculatingUsd: number;
}

export interface StablecoinFlowWindow {
  changeUsd: number;
  changePct: number;
  /**
   * The day actually compared against. Rarely exactly N days back — the
   * series can have gaps — so it is reported rather than assumed, and the
   * UI can say what the number really covers.
   */
  fromDay: string;
}

export interface StablecoinFlow {
  latestUsd: number;
  /** Day of the most recent point. Daily data lags, so this is not "today". */
  asOfDay: string;
  /** Null when history doesn't reach back far enough — never a fabricated 0. */
  change7d: StablecoinFlowWindow | null;
  change30d: StablecoinFlowWindow | null;
}

/**
 * `points` must be sorted oldest→newest. Returns null on an empty series
 * rather than a zeroed object, so callers can't render "$0 flow" for
 * "no data yet".
 */
export function computeStablecoinFlow(points: StablecoinSupplyPoint[]): StablecoinFlow | null {
  const latest = points[points.length - 1];
  if (!latest) return null;

  return {
    latestUsd: latest.totalCirculatingUsd,
    asOfDay: latest.day,
    change7d: windowChange(points, latest, 7),
    change30d: windowChange(points, latest, 30),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Finds the newest point at least `days` before the latest one. Requiring
 * "at least" rather than "closest" keeps the window from silently
 * shrinking when recent days are missing — a 7d change measured over 4
 * days would understate the move without saying so.
 */
function windowChange(
  points: StablecoinSupplyPoint[],
  latest: StablecoinSupplyPoint,
  days: number,
): StablecoinFlowWindow | null {
  const cutoffMs = Date.parse(`${latest.day}T00:00:00Z`) - days * DAY_MS;
  if (!Number.isFinite(cutoffMs)) return null;

  let candidate: StablecoinSupplyPoint | undefined;
  for (const point of points) {
    const pointMs = Date.parse(`${point.day}T00:00:00Z`);
    if (!Number.isFinite(pointMs)) continue;
    if (pointMs <= cutoffMs) candidate = point;
    else break;
  }

  if (!candidate || candidate.totalCirculatingUsd === 0) return null;

  const changeUsd = latest.totalCirculatingUsd - candidate.totalCirculatingUsd;
  return {
    changeUsd,
    changePct: (changeUsd / candidate.totalCirculatingUsd) * 100,
    fromDay: candidate.day,
  };
}
