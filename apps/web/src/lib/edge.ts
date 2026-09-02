/**
 * Whether a signal's hit rate is distinguishable from the baseline.
 *
 * The card used to subtract two percentages and colour the result green
 * when the difference was positive. That treats 30 samples and 10.000
 * samples identically, so a signal at 58% on 30 outcomes rendered as
 * "+7pp" in green against a 51% baseline — implying an edge when the true
 * rate could be anywhere from about 40% to 76%.
 *
 * That is precisely the claim this project refuses to make everywhere
 * else, surviving in the one component whose whole job is to make the
 * judgement. The `sufficientData` gate decides a number may be *shown*;
 * it says nothing about whether the number is *different* from doing
 * nothing.
 */

export type EdgeVerdict =
  /** The interval clears the baseline: better than doing nothing. */
  | 'beats'
  /** The interval is entirely below it: worse than doing nothing. */
  | 'worse'
  /** The intervals overlap. Not "no edge" — not enough evidence to tell. */
  | 'indistinguishable';

/** 95% two-sided. */
const Z = 1.96;

/**
 * Standard error of the difference between two proportions. The baseline's
 * own uncertainty is included rather than treated as exact — it is small
 * at ten thousand windows, but writing the test correctly costs one term
 * and stops the comparison being wrong on a fresh install where the
 * baseline is thin too.
 */
export function differenceMarginPp(
  hitPct: number,
  sampleCount: number,
  baselinePct: number,
  baselineSampleCount: number,
): number | null {
  if (sampleCount <= 0 || baselineSampleCount <= 0) return null;
  const p1 = hitPct / 100;
  const p2 = baselinePct / 100;
  const variance = (p1 * (1 - p1)) / sampleCount + (p2 * (1 - p2)) / baselineSampleCount;
  return Z * Math.sqrt(variance) * 100;
}

export function compareToBaseline(
  hitPct: number,
  sampleCount: number,
  baselinePct: number,
  baselineSampleCount: number,
): { verdict: EdgeVerdict; deltaPp: number; marginPp: number | null } {
  const deltaPp = hitPct - baselinePct;
  const marginPp = differenceMarginPp(hitPct, sampleCount, baselinePct, baselineSampleCount);

  if (marginPp === null) return { verdict: 'indistinguishable', deltaPp, marginPp };
  if (deltaPp - marginPp > 0) return { verdict: 'beats', deltaPp, marginPp };
  if (deltaPp + marginPp < 0) return { verdict: 'worse', deltaPp, marginPp };
  return { verdict: 'indistinguishable', deltaPp, marginPp };
}

/** How many samples this hit rate would need before the gap could be called real. */
export function samplesNeeded(hitPct: number, baselinePct: number, baselineSampleCount: number): number | null {
  const deltaPp = Math.abs(hitPct - baselinePct);
  if (deltaPp === 0) return null;
  const p1 = hitPct / 100;
  const p2 = baselinePct / 100;
  const baselineVariance = (p2 * (1 - p2)) / baselineSampleCount;
  const target = (deltaPp / 100 / Z) ** 2;
  if (target <= baselineVariance) return null; // unreachable while the baseline is this thin
  return Math.ceil((p1 * (1 - p1)) / (target - baselineVariance));
}
