import type { Pool } from 'pg';
import {
  getBaselinePerformance,
  getSignalPerformance,
  type BaselinePerformance,
  type OutcomeHorizon,
  type SignalPerformance,
} from './outcomes.js';
import { compareToBaseline, samplesNeeded, type EdgeVerdict } from './edge.js';
import type { DataSource } from './provenance.js';

/**
 * The horizon and provenance every surface outside /performance reports on.
 *
 * Fixed in advance, and deliberately not chosen per signal type. Picking
 * whichever horizon happens to show the strongest result for a given type
 * is the same cherry-picking the confidence interval exists to prevent —
 * it would turn four honest tests into one dishonest headline. 4h is long
 * enough that the median move clears rounding and short enough that most
 * recorded outcomes have reached it.
 *
 * 'all' rather than 'live' because the replayed samples are what make any
 * type reach a conclusive sample size at present; every surface that shows
 * a verdict says which window it came from.
 */
export const VERDICT_HORIZON: OutcomeHorizon = '4h';
export const VERDICT_SOURCE = 'all' as const;

export interface SignalVerdict {
  signalType: string;
  horizon: OutcomeHorizon;
  source: string;
  verdict: EdgeVerdict;
  deltaPp: number;
  marginPp: number | null;
  sampleCount: number;
  hitPct: number;
  baselinePct: number;
  baselineSampleCount: number;
  comparisons: number;
  computedAt: number;
}

/**
 * Judges every signal type against the baseline in one pass.
 *
 * One pass matters: the confidence interval widens with the number of
 * types being judged together, so a type cannot be evaluated in isolation
 * and get the same answer. Types without enough samples are dropped rather
 * than returned as 'indistinguishable' — "we have not measured this" and
 * "we measured it and cannot tell" are different statements, and only the
 * second one is a finding.
 */
export function judgeSignalTypes(
  results: readonly SignalPerformance[],
  baseline: BaselinePerformance,
  nowMs: number,
): SignalVerdict[] {
  if (baseline.positiveMovePct === null || baseline.sampleCount === 0) return [];

  const judged = results.filter(
    (r): r is SignalPerformance & { positiveMovePct: number } =>
      r.sufficientData && r.positiveMovePct !== null,
  );
  const comparisons = judged.length;

  return judged.map((r) => {
    const { verdict, deltaPp, marginPp } = compareToBaseline(
      r.positiveMovePct,
      r.sampleCount,
      baseline.positiveMovePct as number,
      baseline.sampleCount,
      comparisons,
    );
    return {
      signalType: r.signalType,
      horizon: r.horizon,
      source: r.source ?? 'all',
      verdict,
      deltaPp,
      marginPp,
      sampleCount: r.sampleCount,
      hitPct: r.positiveMovePct,
      baselinePct: baseline.positiveMovePct as number,
      baselineSampleCount: baseline.sampleCount,
      comparisons,
      computedAt: nowMs,
    };
  });
}

/** How many more samples a still-undecided type needs, using the same correction. */
export function verdictSamplesNeeded(v: SignalVerdict): number | null {
  if (v.verdict !== 'indistinguishable') return null;
  return samplesNeeded(v.hitPct, v.baselinePct, v.baselineSampleCount, v.comparisons);
}

export async function computeSignalVerdicts(
  pool: Pool,
  signalTypes: readonly string[],
  nowMs: number = Date.now(),
): Promise<SignalVerdict[]> {
  const source: DataSource | undefined = VERDICT_SOURCE === 'all' ? undefined : VERDICT_SOURCE;
  const [results, baseline] = await Promise.all([
    Promise.all(signalTypes.map((t) => getSignalPerformance(pool, t, VERDICT_HORIZON, source))),
    getBaselinePerformance(pool, VERDICT_HORIZON, source),
  ]);
  return judgeSignalTypes(results, baseline, nowMs);
}

/**
 * Replaces the stored verdicts for this (horizon, source) wholesale.
 *
 * Wholesale because a type that has dropped below the sample threshold —
 * possible when provenance filters change, or when rows are pruned — must
 * stop having a verdict, not keep the last one forever. A stale "worse
 * than doing nothing" badge on a type nobody is measuring any more is
 * exactly the kind of confident-and-wrong the rest of this project spends
 * its effort avoiding.
 */
export async function saveSignalVerdicts(pool: Pool, verdicts: readonly SignalVerdict[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM signal_verdicts WHERE horizon = $1 AND source = $2', [
      VERDICT_HORIZON,
      VERDICT_SOURCE,
    ]);
    for (const v of verdicts) {
      await client.query(
        `INSERT INTO signal_verdicts
           (signal_type, horizon, source, verdict, delta_pp, margin_pp, sample_count, hit_pct,
            baseline_pct, baseline_sample_count, comparisons, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12/1000.0))`,
        [
          v.signalType,
          v.horizon,
          v.source,
          v.verdict,
          v.deltaPp,
          v.marginPp,
          v.sampleCount,
          v.hitPct,
          v.baselinePct,
          v.baselineSampleCount,
          v.comparisons,
          v.computedAt,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getSignalVerdicts(pool: Pool): Promise<SignalVerdict[]> {
  const { rows } = await pool.query(
    `SELECT signal_type, horizon, source, verdict, delta_pp, margin_pp, sample_count, hit_pct,
            baseline_pct, baseline_sample_count, comparisons,
            extract(epoch from computed_at)*1000 AS computed_at_ms
       FROM signal_verdicts
      WHERE horizon = $1 AND source = $2
      ORDER BY signal_type`,
    [VERDICT_HORIZON, VERDICT_SOURCE],
  );
  return rows.map((r) => ({
    signalType: r.signal_type as string,
    horizon: r.horizon as OutcomeHorizon,
    source: r.source as string,
    verdict: r.verdict as EdgeVerdict,
    deltaPp: Number(r.delta_pp),
    marginPp: r.margin_pp === null ? null : Number(r.margin_pp),
    sampleCount: Number(r.sample_count),
    hitPct: Number(r.hit_pct),
    baselinePct: Number(r.baseline_pct),
    baselineSampleCount: Number(r.baseline_sample_count),
    comparisons: Number(r.comparisons),
    computedAt: Number(r.computed_at_ms),
  }));
}

/**
 * The one-line warning a surface shows next to a signal type.
 *
 * Null for anything but a `worse` verdict. 'beats' deliberately gets no
 * badge: a green label next to a live signal reads as a recommendation,
 * and this project does not make recommendations — the performance page
 * is where somebody can go and read the evidence in full. A warning that
 * the evidence points the other way is a different matter, because the
 * default reading of a firing signal is already "this is worth acting on".
 */
export function verdictWarning(v: SignalVerdict | undefined): string | null {
  if (!v || v.verdict !== 'worse') return null;
  const delta = v.deltaPp.toFixed(0);
  return `Loại tín hiệu này đang kém hơn mức nền: ${delta}pp tỉ lệ đúng trên ${v.sampleCount.toLocaleString('vi-VN')} mẫu (khung ${v.horizon}).`;
}
