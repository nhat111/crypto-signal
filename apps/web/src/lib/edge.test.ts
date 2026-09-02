import { describe, expect, it } from 'vitest';
import { compareToBaseline, samplesNeeded } from './edge';

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
