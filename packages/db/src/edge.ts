/**
 * Whether a signal's hit rate is distinguishable from the baseline.
 *
 * Lives here rather than in the web app because three surfaces now ask the
 * same question — the performance page, the signal list, and the Telegram
 * alert — and the web app deliberately has no workspace dependencies, so a
 * copy over there would be a second implementation free to drift from this
 * one. The API computes the verdict and every surface renders it.
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

/** Family-wise error rate: the chance of *any* false flag across a whole screen of cards. */
const FAMILY_ALPHA = 0.05;

/**
 * Inverse standard normal CDF — Acklam's rational approximation, accurate
 * to about 1.15e-9 over the whole open interval, which is several orders
 * of magnitude more than a percentage rounded to one decimal needs.
 *
 * Needed because the critical value is no longer the constant 1.96: once
 * the significance level moves with the number of comparisons, so does z.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile expects 0 < p < 1, got ${p}`);

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q + (c[4] as number)) * q + (c[5] as number)) /
      ((((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1))
    );
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      ((((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q + (c[4] as number)) * q + (c[5] as number)) /
      ((((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1))
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    (((((((a[0] as number) * r + (a[1] as number)) * r + (a[2] as number)) * r + (a[3] as number)) * r + (a[4] as number)) * r + (a[5] as number)) * q) /
    ((((((b[0] as number) * r + (b[1] as number)) * r + (b[2] as number)) * r + (b[3] as number)) * r + (b[4] as number)) * r + 1)
  );
}

/**
 * The critical value for one card when `comparisons` cards are judged at once.
 *
 * A 95% test is wrong one time in twenty *per test*. The performance page
 * renders nine signal types side by side, so at the old fixed 1.96 a
 * screen of cards was expected to produce a false "beats" or "worse"
 * roughly every other visit — and the reader's eye goes straight to
 * whichever card is coloured. That is not a rounding-level concern: it is
 * the page inventing exactly one finding, which is what a reader would
 * act on.
 *
 * Šidák rather than Bonferroni — same intent, slightly less conservative,
 * and exact when the tests are independent. They are not fully
 * independent here (the cards share a baseline and overlapping market
 * windows), which makes this mildly conservative rather than wrong.
 *
 * It corrects for the cards on one screen. Clicking through horizons and
 * sources widens the real family further, and no client-side correction
 * can see that — the copy on the page says so rather than pretending the
 * number covers it.
 */
export function criticalZ(comparisons: number): number {
  const m = Math.max(1, Math.floor(comparisons));
  const perTestAlpha = 1 - Math.pow(1 - FAMILY_ALPHA, 1 / m);
  return normalQuantile(1 - perTestAlpha / 2);
}

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
  comparisons = 1,
): number | null {
  if (sampleCount <= 0 || baselineSampleCount <= 0) return null;
  const p1 = hitPct / 100;
  const p2 = baselinePct / 100;
  const variance = (p1 * (1 - p1)) / sampleCount + (p2 * (1 - p2)) / baselineSampleCount;
  return criticalZ(comparisons) * Math.sqrt(variance) * 100;
}

export function compareToBaseline(
  hitPct: number,
  sampleCount: number,
  baselinePct: number,
  baselineSampleCount: number,
  comparisons = 1,
): { verdict: EdgeVerdict; deltaPp: number; marginPp: number | null } {
  const deltaPp = hitPct - baselinePct;
  const marginPp = differenceMarginPp(hitPct, sampleCount, baselinePct, baselineSampleCount, comparisons);

  if (marginPp === null) return { verdict: 'indistinguishable', deltaPp, marginPp };
  if (deltaPp - marginPp > 0) return { verdict: 'beats', deltaPp, marginPp };
  if (deltaPp + marginPp < 0) return { verdict: 'worse', deltaPp, marginPp };
  return { verdict: 'indistinguishable', deltaPp, marginPp };
}

/** How many samples this hit rate would need before the gap could be called real. */
export function samplesNeeded(
  hitPct: number,
  baselinePct: number,
  baselineSampleCount: number,
  comparisons = 1,
): number | null {
  const deltaPp = Math.abs(hitPct - baselinePct);
  if (deltaPp === 0) return null;
  const z = criticalZ(comparisons);
  const p1 = hitPct / 100;
  const p2 = baselinePct / 100;
  const baselineVariance = (p2 * (1 - p2)) / baselineSampleCount;
  const target = (deltaPp / 100 / z) ** 2;
  if (target <= baselineVariance) return null; // unreachable while the baseline is this thin
  return Math.ceil((p1 * (1 - p1)) / (target - baselineVariance));
}
