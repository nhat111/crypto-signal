import { describe, expect, it } from 'vitest';
import {
  baselineReadiness,
  controlConcentration,
  formatBaselineReport,
  MIN_BASELINE_SAMPLES,
  type BaselineReportInput,
} from './baselineReport.js';

const ready: BaselineReportInput = {
  horizon: '7d',
  sampleCount: 40,
  netPositiveMovePct: 30,
  medianMovePct: 2,
  sufficientData: true,
  baseline: {
    sampleCount: 50,
    netPositiveMovePct: 18,
    medianMovePct: -4,
    deltaPp: 12,
    marginPp: 8,
    verdict: 'beats',
    medianDeltaPp: 6,
    failureCounts: { extreme_pump: 10, low_liquidity: 12, thin_volume: 9 },
  },
};

describe('baselineReadiness', () => {
  it('separates "no control priced" from "the control scored zero"', () => {
    const { baseline: _b, ...noBaseline } = ready;
    expect(baselineReadiness(noBaseline).state).toBe('no_control');
    expect(baselineReadiness({ ...ready, baseline: { ...ready.baseline!, sampleCount: 0 } }).state).toBe('no_control');
  });

  it('waits while either side is below the threshold', () => {
    const thinScanner = baselineReadiness({ ...ready, sampleCount: 5, sufficientData: false });
    expect(thinScanner).toMatchObject({ state: 'waiting', scannerSamples: 5, needed: MIN_BASELINE_SAMPLES });

    const thinControl = baselineReadiness({ ...ready, baseline: { ...ready.baseline!, sampleCount: 7 } });
    expect(thinControl).toMatchObject({ state: 'waiting', baselineSamples: 7 });
  });

  it('is ready only when both sides clear it', () => {
    expect(baselineReadiness(ready)).toEqual({ state: 'ready', verdict: 'beats' });
  });
});

describe('controlConcentration', () => {
  it('names the reason that dominates the control', () => {
    expect(controlConcentration({ extreme_pump: 45, low_liquidity: 5 }, 50)).toEqual({
      reason: 'extreme_pump',
      sharePct: 90,
    });
  });

  it('reports nothing when there are no counts to read', () => {
    expect(controlConcentration(undefined, 50)).toBeNull();
    expect(controlConcentration({}, 50)).toBeNull();
  });

  it('does not divide by a zero sample count', () => {
    expect(controlConcentration({ extreme_pump: 3 }, 0)).toBeNull();
  });
});

describe('formatBaselineReport', () => {
  const text = (i: BaselineReportInput) => formatBaselineReport(i).join('\n');

  it('quotes no percentages while the data is thin', () => {
    const out = text({ ...ready, sampleCount: 6, sufficientData: false });
    expect(out).toMatch(/Not enough outcomes yet/);
    expect(out).toMatch(/6\/20/);
    // The whole point of the threshold: a hit rate off six outcomes reads
    // like a finding. It must not appear at all.
    expect(out).not.toMatch(/net winners/);
  });

  it('says a losing scanner should be switched off, not retuned', () => {
    const out = text({ ...ready, baseline: { ...ready.baseline!, verdict: 'worse', deltaPp: -9 } });
    expect(out).toMatch(/LOSES to its rejects/);
    expect(out).toMatch(/switch gem alerts off/);
    expect(out).toMatch(/not to retune/);
  });

  it('does not read an inconclusive result as evidence of no edge', () => {
    const out = text({ ...ready, baseline: { ...ready.baseline!, verdict: 'indistinguishable', deltaPp: 2 } });
    expect(out).toMatch(/absence of evidence/);
  });

  it('warns when the control is really one rejection reason wearing a market costume', () => {
    const out = text({
      ...ready,
      baseline: { ...ready.baseline!, sampleCount: 50, failureCounts: { extreme_pump: 40, thin_volume: 3 } },
    });
    expect(out).toMatch(/80% of the control was rejected for/);
    expect(out).toMatch(/narrower than a comparison against the market/);
  });

  it('does not caption a losing verdict as if the scanner had won', () => {
    // The caveat used to be hardcoded to "beats tokens rejected for ...",
    // so a LOSES verdict carried a sentence claiming the opposite. Only
    // rendering it caught that, so it is pinned here.
    const out = text({
      ...ready,
      baseline: {
        ...ready.baseline!,
        verdict: 'worse',
        deltaPp: -57.5,
        sampleCount: 50,
        failureCounts: { thin_volume: 34, low_liquidity: 16 },
      },
    });
    expect(out).toMatch(/LOSES to its rejects/);
    expect(out).toMatch(/68% of the control was rejected for/);
    expect(out).not.toMatch(/beats tokens rejected for/);
  });

  it('stays quiet about concentration when the control is mixed', () => {
    expect(text(ready)).not.toMatch(/of the control was rejected for/);
  });

  it('shows the margin next to the gap so the gap is never read alone', () => {
    const out = text(ready);
    expect(out).toMatch(/\+12pp/);
    expect(out).toMatch(/±8pp/);
  });

  it('prints n/a rather than a fabricated zero for a missing figure', () => {
    const out = text({
      ...ready,
      netPositiveMovePct: null,
      baseline: { ...ready.baseline!, netPositiveMovePct: null, marginPp: null, medianDeltaPp: null },
    });
    expect(out).toMatch(/n\/a/);
    expect(out).not.toMatch(/needs ±/);
  });
});
