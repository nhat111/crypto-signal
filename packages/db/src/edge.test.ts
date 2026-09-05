import { describe, expect, it } from 'vitest';
import { compareToBaseline, criticalZ, differenceMarginPp, normalQuantile, samplesNeeded } from './edge.js';

// The live baseline at the time this was written: 51% over 10.736 windows.
const BASE = 51;
const BASE_N = 10_736;

describe('compareToBaseline', () => {
  it('refuses to call a small-sample lead an edge', () => {
    // The exact case the old card got wrong: +7pp looks convincing and is
    // nothing at all — the interval spans roughly 40% to 76%.
    const r = compareToBaseline(58, 30, BASE, BASE_N);
    expect(r.verdict).toBe('indistinguishable');
    expect(r.deltaPp).toBeCloseTo(7, 5);
    expect(r.marginPp).toBeGreaterThan(15);
  });

  it('calls the same lead an edge once there are enough samples', () => {
    // Same 58%, 500 outcomes instead of 30.
    expect(compareToBaseline(58, 500, BASE, BASE_N).verdict).toBe('beats');
  });

  it('needs a bigger lead at the minimum sample size than at a large one', () => {
    expect(compareToBaseline(65, 30, BASE, BASE_N).verdict).toBe('indistinguishable');
    expect(compareToBaseline(75, 30, BASE, BASE_N).verdict).toBe('beats');
  });

  it('flags a signal that is reliably worse than doing nothing', () => {
    // Worth knowing, and the old card coloured this amber alongside a
    // 0.4pp shortfall on twelve samples, which are not the same finding.
    expect(compareToBaseline(30, 400, BASE, BASE_N).verdict).toBe('worse');
  });

  it('treats a signal sitting on the baseline as indistinguishable, not as beating it', () => {
    expect(compareToBaseline(51, 1000, BASE, BASE_N).verdict).toBe('indistinguishable');
    expect(compareToBaseline(51.4, 1000, BASE, BASE_N).verdict).toBe('indistinguishable');
  });

  it('does not divide by zero on an empty baseline', () => {
    const r = compareToBaseline(60, 100, 50, 0);
    expect(r.verdict).toBe('indistinguishable');
    expect(r.marginPp).toBeNull();
  });
});

describe('samplesNeeded', () => {
  it('says how far off the evidence is, so "not yet" has a number', () => {
    const n = samplesNeeded(58, BASE, BASE_N);
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThan(1000);
    // And that number must actually be enough.
    expect(compareToBaseline(58, n as number, BASE, BASE_N).verdict).toBe('beats');
  });

  it('asks for more when the lead is smaller', () => {
    expect(samplesNeeded(53, BASE, BASE_N) as number).toBeGreaterThan(samplesNeeded(58, BASE, BASE_N) as number);
  });

  it('is null when there is no gap to prove', () => {
    expect(samplesNeeded(51, BASE, BASE_N)).toBeNull();
  });
});

describe('normalQuantile', () => {
  // Table values, so an approximation that silently drifts is caught rather
  // than trusted. The 1.959964 row is the constant this file used to hard-code.
  it.each([
    [0.975, 1.959964],
    [0.995, 2.575829],
    [0.9995, 3.290527],
    [0.75, 0.674490],
    [0.5, 0],
  ])('matches the table at p=%s', (p, expected) => {
    expect(normalQuantile(p as number)).toBeCloseTo(expected as number, 5);
  });

  it('is symmetric about the median', () => {
    for (const p of [0.6, 0.9, 0.99, 0.999]) {
      expect(normalQuantile(p)).toBeCloseTo(-normalQuantile(1 - p), 6);
    }
  });

  it('rejects probabilities outside the open interval instead of returning Infinity', () => {
    expect(() => normalQuantile(0)).toThrow(RangeError);
    expect(() => normalQuantile(1)).toThrow(RangeError);
  });
});

describe('criticalZ', () => {
  it('is the familiar 1.96 for a single comparison', () => {
    expect(criticalZ(1)).toBeCloseTo(1.959964, 5);
  });

  it('demands more evidence as more cards are judged at once', () => {
    expect(criticalZ(9)).toBeGreaterThan(criticalZ(5));
    expect(criticalZ(5)).toBeGreaterThan(criticalZ(1));
  });

  it('treats a nonsensical count as one comparison rather than blowing up', () => {
    expect(criticalZ(0)).toBeCloseTo(criticalZ(1), 10);
    expect(criticalZ(-3)).toBeCloseTo(criticalZ(1), 10);
  });
});

describe('multiple comparisons', () => {
  // The whole point: a lead that clears a lone 95% test should stop
  // clearing it once the same screen runs nine of them.
  it('withdraws a borderline verdict when the family is the whole page', () => {
    const alone = compareToBaseline(56.5, 400, BASE, BASE_N, 1);
    const onAPageOfNine = compareToBaseline(56.5, 400, BASE, BASE_N, 9);
    expect(alone.verdict).toBe('beats');
    expect(onAPageOfNine.verdict).toBe('indistinguishable');
    expect(onAPageOfNine.marginPp as number).toBeGreaterThan(alone.marginPp as number);
  });

  it('keeps a verdict that was never borderline', () => {
    // Selling Absorption's real shape at 4h: -3pp on ten thousand samples.
    expect(compareToBaseline(48, 10_655, BASE, BASE_N, 9).verdict).toBe('worse');
  });

  it('raises the sample count it asks for, and that count still suffices', () => {
    const one = samplesNeeded(58, BASE, BASE_N, 1) as number;
    const nine = samplesNeeded(58, BASE, BASE_N, 9) as number;
    expect(nine).toBeGreaterThan(one);
    expect(compareToBaseline(58, nine, BASE, BASE_N, 9).verdict).toBe('beats');
  });
});

describe('the hole at 0% and 100%', () => {
  const BASELINE = 50;
  const BASELINE_N = 100;

  it('refuses to call one lucky observation a finding', () => {
    // The plain Wald formula this replaced put the variance of a 100% arm
    // at exactly zero, so a single row that happened to win produced a
    // 9,8pp margin against a 50pp gap and the page said "beats". A rule
    // against claiming edge without evidence, defeated by having almost
    // none.
    expect(compareToBaseline(100, 1, BASELINE, BASELINE_N).verdict).toBe('indistinguishable');
    expect(compareToBaseline(0, 1, BASELINE, BASELINE_N).verdict).toBe('indistinguishable');
  });

  it('refuses a perfect run of three', () => {
    expect(compareToBaseline(100, 3, BASELINE, BASELINE_N).verdict).toBe('indistinguishable');
    expect(compareToBaseline(0, 3, BASELINE, BASELINE_N).verdict).toBe('indistinguishable');
  });

  it('still decides once a perfect run is actually long', () => {
    // Conservative, not mute: forty straight wins against a coin flip is a
    // finding, and refusing to say so would be its own kind of dishonesty.
    expect(compareToBaseline(100, 40, BASELINE, BASELINE_N).verdict).toBe('beats');
    expect(compareToBaseline(0, 40, BASELINE, BASELINE_N).verdict).toBe('worse');
  });

  it('never reports a margin of zero, whatever the split', () => {
    // Zero margin means infinite confidence, which no sample size buys.
    for (const [pct, n] of [[100, 1], [0, 1], [100, 5], [0, 5], [100, 500]] as const) {
      expect(differenceMarginPp(pct, n, BASELINE, BASELINE_N), `${pct}% of ${n}`).toBeGreaterThan(0);
    }
  });

  it('leaves production-sized samples where they were', () => {
    // The adjustment must not quietly rewrite verdicts that were already
    // resting on tens of thousands of rows.
    const margin = differenceMarginPp(51, 10_655, 54, 35_547, 9) as number;
    expect(margin).toBeGreaterThan(1.4);
    expect(margin).toBeLessThan(1.7);
  });

  it('asks for a sample count that actually delivers a verdict', () => {
    // The promise this function makes has to be keepable, including from a
    // degenerate starting point.
    for (const hitPct of [100, 0, 58, 42]) {
      const needed = samplesNeeded(hitPct, BASELINE, BASELINE_N);
      if (needed === null) continue;
      expect(compareToBaseline(hitPct, needed, BASELINE, BASELINE_N).verdict, `${hitPct}%`).not.toBe(
        'indistinguishable',
      );
      // And it must be the *smallest* such count, not a safe overestimate.
      expect(compareToBaseline(hitPct, needed - 1, BASELINE, BASELINE_N).verdict, `${hitPct}% minus one`).toBe(
        'indistinguishable',
      );
    }
  });
});
