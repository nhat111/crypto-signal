import type { Pool } from 'pg';
import type { CoinFlow } from '@crypto-signal/indicators';
import { compareToBaseline, type EdgeVerdict } from './edge.js';
import type { CoinScanExchange } from './coinScan.js';

/**
 * Does the coin scan say anything about what comes next?
 *
 * The scan describes the last 7–30 days. That is only worth reading if the
 * description leans on the future at all, and the only honest way to find
 * out is the way signals are judged here: what each group did afterwards,
 * against a baseline, with a margin that knows how many samples it has.
 *
 * - A "win" is beating BTC over the horizon (coin return − BTC return > 0),
 *   because "is it stronger than BTC" is the question the scan asks.
 * - Relative strength: the top fifth by 30-day RS against the bottom fifth,
 *   on the same days.
 * - Flow labels: each label against every coin scanned on the same days.
 * - Cohort days are spaced a whole horizon apart. Daily cohorts with a
 *   7-day horizon would count each week seven times and make a few weeks
 *   look like a few months of evidence.
 * - A sample needs the same exchange at both ends (Binance and OKX prices
 *   and flows are kept apart), and each exchange is judged separately.
 */

export interface CoinScanEdgeInputRow {
  day: string;
  symbol: string;
  close: number;
  rs30d: number | null;
  flow: CoinFlow;
  exchange: CoinScanExchange;
}

export interface CoinScanEdgeGroup {
  samples: number;
  /** Share of samples that beat BTC over the horizon. Null with no samples. */
  hitPct: number | null;
  /** Mean of coin − BTC return over the horizon, in percent. */
  meanExcessPct: number | null;
}

export interface CoinScanEdgeComparison {
  group: CoinScanEdgeGroup;
  baseline: CoinScanEdgeGroup;
  /** Null below the sample floor: nothing is judged on a handful of rows. */
  verdict: EdgeVerdict | null;
  deltaPp: number | null;
  marginPp: number | null;
}

export interface CoinScanEdgeReport {
  exchange: CoinScanExchange;
  horizonDays: number;
  cohortDays: number;
  /** Top fifth by 30-day RS, judged against the bottom fifth. */
  relativeStrength: CoinScanEdgeComparison;
  /** Each label seen, judged against all coins on the same days. */
  flows: Array<{ flow: CoinFlow } & CoinScanEdgeComparison>;
}

/** Below this many samples in a group, its hit rate is not shown as evidence. Same floor as the setup stats. */
export const COIN_EDGE_MIN_SAMPLES = 20;

const DAY_MS = 86_400_000;
const BTC = 'BTCUSDT';

const dayIndex = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

interface Sample {
  excessPct: number;
  rs30d: number | null;
  flow: CoinFlow;
  cohort: number;
}

function summarise(samples: Sample[]): CoinScanEdgeGroup {
  if (samples.length === 0) return { samples: 0, hitPct: null, meanExcessPct: null };
  const wins = samples.filter((s) => s.excessPct > 0).length;
  return {
    samples: samples.length,
    hitPct: (wins / samples.length) * 100,
    meanExcessPct: samples.reduce((sum, s) => sum + s.excessPct, 0) / samples.length,
  };
}

function compare(group: Sample[], baseline: Sample[], comparisons: number): CoinScanEdgeComparison {
  const g = summarise(group);
  const b = summarise(baseline);
  if (g.samples < COIN_EDGE_MIN_SAMPLES || b.samples < COIN_EDGE_MIN_SAMPLES || g.hitPct === null || b.hitPct === null) {
    return { group: g, baseline: b, verdict: null, deltaPp: null, marginPp: null };
  }
  const { verdict, deltaPp, marginPp } = compareToBaseline(g.hitPct, g.samples, b.hitPct, b.samples, comparisons);
  return { group: g, baseline: b, verdict, deltaPp, marginPp };
}

/** One exchange's samples: every coin on every cohort day whose horizon has elapsed, priced against BTC on the same days. */
function samplesFor(rows: CoinScanEdgeInputRow[], exchange: CoinScanExchange, horizonDays: number): { samples: Sample[]; cohortDays: number } {
  const byDay = new Map<number, Map<string, CoinScanEdgeInputRow>>();
  for (const r of rows) {
    const d = dayIndex(r.day);
    if (!byDay.has(d)) byDay.set(d, new Map());
    (byDay.get(d) as Map<string, CoinScanEdgeInputRow>).set(r.symbol, r);
  }

  const samples: Sample[] = [];
  let cohortDays = 0;
  for (const [d, today] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    // Fixed grid rather than "first day, then every h": adding history at
    // the start must not shift which days count.
    if (d % horizonDays !== 0) continue;
    const later = byDay.get(d + horizonDays);
    const btcNow = today.get(BTC);
    const btcLater = later?.get(BTC);
    if (!later || !btcNow || !btcLater || btcNow.exchange !== exchange || btcLater.exchange !== exchange) continue;
    const btcReturn = btcLater.close / btcNow.close - 1;

    let counted = false;
    for (const [symbol, now] of today) {
      if (symbol === BTC) continue;
      const then = later.get(symbol);
      if (!then || now.exchange !== exchange || then.exchange !== exchange || now.close <= 0) continue;
      samples.push({ excessPct: (then.close / now.close - 1 - btcReturn) * 100, rs30d: now.rs30d, flow: now.flow, cohort: d });
      counted = true;
    }
    if (counted) cohortDays += 1;
  }
  return { samples, cohortDays };
}

/** Top and bottom fifth by 30-day RS, chosen within each cohort day so a strong week cannot fill both ends. */
function rsQuintiles(samples: Sample[]): { top: Sample[]; bottom: Sample[] } {
  const top: Sample[] = [];
  const bottom: Sample[] = [];
  const byCohort = new Map<number, Sample[]>();
  for (const s of samples) {
    if (s.rs30d === null) continue;
    if (!byCohort.has(s.cohort)) byCohort.set(s.cohort, []);
    (byCohort.get(s.cohort) as Sample[]).push(s);
  }
  for (const day of byCohort.values()) {
    if (day.length < 5) continue;
    const sorted = [...day].sort((a, b) => (b.rs30d as number) - (a.rs30d as number));
    const k = Math.floor(sorted.length / 5);
    top.push(...sorted.slice(0, k));
    bottom.push(...sorted.slice(-k));
  }
  return { top, bottom };
}

/** Pure, so the grouping and the spacing can be tested without a database. */
export function evaluateCoinScan(rows: CoinScanEdgeInputRow[], horizonDays: number): CoinScanEdgeReport[] {
  const exchanges = [...new Set(rows.map((r) => r.exchange))].sort();
  return exchanges.map((exchange) => {
    const { samples, cohortDays } = samplesFor(rows, exchange, horizonDays);
    const { top, bottom } = rsQuintiles(samples);

    const labels = [...new Set(samples.map((s) => s.flow))].sort();
    // One family per report: the RS comparison plus every label shown next
    // to it, so a screen of comparisons is not a screen of coin flips.
    const comparisons = 1 + labels.length;
    return {
      exchange,
      horizonDays,
      cohortDays,
      relativeStrength: compare(top, bottom, comparisons),
      flows: labels.map((flow) => ({ flow, ...compare(samples.filter((s) => s.flow === flow), samples, comparisons) })),
    };
  });
}

/** Every stored day — about 30 rows a day, so a year is ~11k narrow rows. */
export async function getCoinScanEdge(pool: Pool, horizonDays: number): Promise<CoinScanEdgeReport[]> {
  const { rows } = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, symbol, close, rs_30d, flow, exchange FROM coin_scan_rows ORDER BY day`,
  );
  return evaluateCoinScan(
    rows.map((r) => ({
      day: r.day as string,
      symbol: r.symbol as string,
      close: Number(r.close),
      rs30d: r.rs_30d === null ? null : Number(r.rs_30d),
      flow: r.flow as CoinFlow,
      exchange: r.exchange as CoinScanExchange,
    })),
    horizonDays,
  );
}

export const COIN_EDGE_HORIZONS = [7, 30] as const;
