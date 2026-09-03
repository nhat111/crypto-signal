import { describe, expect, it } from 'vitest';
import { judgeSignalTypes, verdictSamplesNeeded, verdictWarning, type SignalVerdict } from './verdicts.js';
import type { BaselinePerformance, SignalPerformance } from './outcomes.js';

const BASELINE: BaselinePerformance = {
  horizon: '4h',
  sampleCount: 35_547,
  positiveMovePct: 54,
  medianMovePct: 0.05,
  netPositiveMovePct: 45,
  netNegativeMovePct: 44,
  costPct: 0.1,
  fromMs: 1,
  toMs: 2,
};

function perf(signalType: string, positiveMovePct: number | null, sampleCount: number): SignalPerformance {
  return {
    signalType,
    sampleCount,
    horizon: '4h',
    positiveMovePct,
    negativeMovePct: positiveMovePct === null ? null : 100 - positiveMovePct,
    medianMovePct: 0,
    netPositiveMovePct: 0,
    netNegativeMovePct: 0,
    costPct: 0.1,
    sufficientData: sampleCount >= 30,
  };
}

describe('judgeSignalTypes', () => {
  it('reaches the conclusion the live data actually supports', () => {
    // Selling Absorption at 4h: 51% on 10.655 samples against a 54%
    // baseline. Small gap, huge sample — reliably worse than doing nothing.
    const [v] = judgeSignalTypes([perf('SELLING_ABSORPTION_POSSIBLE', 51, 10_655)], BASELINE, 0);
    expect(v?.verdict).toBe('worse');
    expect(v?.deltaPp).toBeCloseTo(-3, 5);
  });

  it('refuses to conclude on a thin sample with the same gap', () => {
    const [v] = judgeSignalTypes([perf('SPOT_CONFIRMED_RALLY', 51, 200)], BASELINE, 0);
    expect(v?.verdict).toBe('indistinguishable');
  });

  it('widens the interval as more types are judged together', () => {
    const alone = judgeSignalTypes([perf('A', 51, 10_655)], BASELINE, 0);
    const withEight = judgeSignalTypes(
      [perf('A', 51, 10_655), ...Array.from({ length: 8 }, (_, i) => perf(`T${i}`, 54, 5_000))],
      BASELINE,
      0,
    );
    const a = withEight.find((v) => v.signalType === 'A');
    expect(a?.marginPp as number).toBeGreaterThan(alone[0]?.marginPp as number);
    expect(a?.comparisons).toBe(9);
    expect(alone[0]?.comparisons).toBe(1);
  });

  it('drops types with too few samples instead of calling them undecided', () => {
    // "We have not measured this" and "we measured it and cannot tell" are
    // different statements, and only the second is a finding. A verdict
    // row for the first would put a badge on a type nobody has evidence about.
    const judged = judgeSignalTypes([perf('THIN', 80, 12), perf('THICK', 54, 5_000)], BASELINE, 0);
    expect(judged.map((v) => v.signalType)).toEqual(['THICK']);
  });

  it('concludes nothing at all when there is no baseline to compare against', () => {
    const noBaseline: BaselinePerformance = { ...BASELINE, sampleCount: 0, positiveMovePct: null };
    expect(judgeSignalTypes([perf('A', 51, 10_655)], noBaseline, 0)).toEqual([]);
  });

  it('does not let a thin type inflate the family and bury a real finding', () => {
    // The correction must count claims, not cards: nine types of which one
    // is measurable is one comparison, not nine.
    const judged = judgeSignalTypes(
      [perf('REAL', 51, 10_655), ...Array.from({ length: 8 }, (_, i) => perf(`THIN${i}`, 80, 5))],
      BASELINE,
      0,
    );
    expect(judged).toHaveLength(1);
    expect(judged[0]?.comparisons).toBe(1);
  });
});

describe('verdictSamplesNeeded', () => {
  it('says how far off an undecided type is', () => {
    const [v] = judgeSignalTypes([perf('SPOT_CONFIRMED_RALLY', 52, 1_204)], BASELINE, 0);
    const needed = verdictSamplesNeeded(v as SignalVerdict);
    expect(needed).toBeGreaterThan(1_204);
  });

  it('is null once a verdict has been reached', () => {
    const [v] = judgeSignalTypes([perf('SELLING_ABSORPTION_POSSIBLE', 51, 10_655)], BASELINE, 0);
    expect(verdictSamplesNeeded(v as SignalVerdict)).toBeNull();
  });
});

describe('verdictWarning', () => {
  it('warns only when the evidence points against the signal', () => {
    const worse = judgeSignalTypes([perf('A', 51, 10_655)], BASELINE, 0)[0] as SignalVerdict;
    expect(verdictWarning(worse)).toContain('kém hơn mức nền');
    expect(verdictWarning(worse)).toContain('10.655');
  });

  it('stays silent on a type that beats the baseline', () => {
    // Deliberate asymmetry: a green line beside a live signal reads as a
    // recommendation to trade, which this project does not make.
    const beats = judgeSignalTypes([perf('A', 60, 10_000)], BASELINE, 0)[0] as SignalVerdict;
    expect(beats.verdict).toBe('beats');
    expect(verdictWarning(beats)).toBeNull();
  });

  it('stays silent when nothing has been concluded', () => {
    expect(verdictWarning(undefined)).toBeNull();
    const undecided = judgeSignalTypes([perf('A', 55, 200)], BASELINE, 0)[0] as SignalVerdict;
    expect(verdictWarning(undecided)).toBeNull();
  });
});
