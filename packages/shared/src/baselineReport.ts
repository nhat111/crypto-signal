/**
 * The one question the gem scanner exists to answer: does it beat the
 * tokens it threw away?
 *
 * This lives in shared, and is pure, because two callers must never give
 * different answers to it — the bot's /baseline command reads it through
 * the API, the worker pushes it unprompted from the database, and a
 * divergence between those two would be a disagreement about whether the
 * thing works.
 *
 * It interprets, it does not compute: every number here was decided
 * elsewhere (getGemPerformance, compareToBaseline). What it adds is the
 * reading, including the one nobody wants — that a scanner losing to its
 * own rejects should be switched off rather than tuned.
 */

export type BaselineVerdict = 'beats' | 'worse' | 'indistinguishable';

/** Only the fields the reading needs — a structural subset of the API's GemPerformance, so either caller's shape satisfies it. */
export interface BaselineReportInput {
  horizon: string;
  sampleCount: number;
  netPositiveMovePct?: number | null;
  medianMovePct: number | null;
  sufficientData: boolean;
  baseline?: {
    sampleCount: number;
    netPositiveMovePct: number | null;
    medianMovePct: number | null;
    deltaPp: number;
    marginPp: number | null;
    verdict: BaselineVerdict;
    medianDeltaPp: number | null;
    failureCounts?: Record<string, number>;
  };
}

export type BaselineReadiness =
  /** No control group priced yet — not "the baseline was zero". */
  | { state: 'no_control' }
  /** Outcomes exist but one side is still too thin to compare. */
  | { state: 'waiting'; scannerSamples: number; baselineSamples: number; needed: number }
  | { state: 'ready'; verdict: BaselineVerdict };

export const MIN_BASELINE_SAMPLES = 20;

export function baselineReadiness(input: BaselineReportInput): BaselineReadiness {
  if (!input.baseline || input.baseline.sampleCount === 0) return { state: 'no_control' };
  if (!input.sufficientData || input.baseline.sampleCount < MIN_BASELINE_SAMPLES) {
    return {
      state: 'waiting',
      scannerSamples: input.sampleCount,
      baselineSamples: input.baseline.sampleCount,
      needed: MIN_BASELINE_SAMPLES,
    };
  }
  return { state: 'ready', verdict: input.baseline.verdict };
}

/**
 * The largest share of the control group attributable to one rejection
 * reason, or null when there is nothing to report.
 *
 * A control dominated by a single reason is not a market baseline, it is a
 * baseline of that one reason — if nearly every reject was thrown out for
 * extreme_pump, "beats the rejects" means "beats tokens that had already
 * pumped", which is a much narrower claim than the headline implies.
 */
export function controlConcentration(
  failureCounts: Record<string, number> | undefined,
  baselineSampleCount: number,
): { reason: string; sharePct: number } | null {
  if (!failureCounts || baselineSampleCount <= 0) return null;
  const entries = Object.entries(failureCounts);
  if (entries.length === 0) return null;

  let top = entries[0] as [string, number];
  for (const e of entries) if (e[1] > top[1]) top = e as [string, number];

  const sharePct = Math.round((top[1] / baselineSampleCount) * 1000) / 10;
  return { reason: top[0], sharePct };
}

/** Above this, the control is described as dominated by one reason rather than as a market baseline. */
export const CONCENTRATION_WARN_PCT = 60;

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? 'n/a' : `${v}%`;
}

function signed(v: number | null): string {
  if (v === null) return 'n/a';
  return `${v >= 0 ? '+' : ''}${v}`;
}

/**
 * The whole message, as plain lines. HTML escaping is the caller's job —
 * every value here is a number or a reason slug the scanner itself
 * produced, never user text.
 */
export function formatBaselineReport(input: BaselineReportInput): string[] {
  const readiness = baselineReadiness(input);

  if (readiness.state === 'no_control') {
    return [
      '📊 <b>SCANNER vs ITS OWN REJECTS</b>',
      '',
      'No control group priced yet.',
      '',
      'This is not "the rejects did nothing" — it is that no rejected token has been followed to an outcome so far. Until some have, there is nothing to compare the scanner against.',
    ];
  }

  if (readiness.state === 'waiting') {
    return [
      '📊 <b>SCANNER vs ITS OWN REJECTS</b>',
      '',
      `Not enough outcomes yet — scanner ${readiness.scannerSamples}/${readiness.needed}, control ${readiness.baselineSamples}/${readiness.needed}.`,
      '',
      'No percentages until both sides clear the threshold. A hit rate off a handful of outcomes reads like a finding and is noise.',
      '',
      "<i>You'll get this message unprompted the moment it can be answered.</i>",
    ];
  }

  const b = input.baseline as NonNullable<BaselineReportInput['baseline']>;
  const lines = [
    '📊 <b>SCANNER vs ITS OWN REJECTS</b>',
    '',
    `Horizon: ${input.horizon}`,
    `Scanner: ${pct(input.netPositiveMovePct)} net winners over ${input.sampleCount} calls`,
    `Rejects: ${pct(b.netPositiveMovePct)} over ${b.sampleCount}`,
    `Gap: ${signed(b.deltaPp)}pp${b.marginPp === null ? '' : ` (needs ±${b.marginPp}pp to be real)`}`,
  ];

  if (b.medianDeltaPp !== null) {
    lines.push(`Median move vs control: ${signed(b.medianDeltaPp)}pp`);
  }

  lines.push('', `<b>${verdictHeadline(b.verdict)}</b>`, verdictMeaning(b.verdict));

  const concentration = controlConcentration(b.failureCounts, b.sampleCount);
  if (concentration && concentration.sharePct >= CONCENTRATION_WARN_PCT) {
    lines.push(
      '',
      `⚠️ ${concentration.sharePct}% of the control was rejected for <code>${concentration.reason}</code>.`,
      // Phrased without a direction: the same caveat applies whichever way
      // the verdict went, and an earlier version hardcoded "beats", so a
      // losing verdict was captioned "beats tokens rejected for ...".
      `So this compares the scanner against tokens rejected for ${concentration.reason}, which is narrower than a comparison against the market.`,
    );
  }

  return lines;
}

function verdictHeadline(verdict: BaselineVerdict): string {
  switch (verdict) {
    case 'beats':
      return 'The scanner beats its rejects.';
    case 'worse':
      return 'The scanner LOSES to its rejects.';
    case 'indistinguishable':
      return 'No difference that the data can support.';
  }
}

function verdictMeaning(verdict: BaselineVerdict): string {
  switch (verdict) {
    case 'beats':
      return 'The gap is larger than the margin, so picking is doing something the rejects were not. Costs are already deducted from both sides.';
    case 'worse':
      return 'Buying what it rejected would have done better. The honest move is to switch gem alerts off, not to retune weights — tuning a signal that loses to its own control optimises the losing.';
    case 'indistinguishable':
      return 'The gap is inside the margin. That is not evidence of no edge, it is an absence of evidence either way — more outcomes, or a bigger gap, would be needed to tell.';
  }
}
