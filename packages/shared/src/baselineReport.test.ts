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

  it('separates a control that is missing from one that is merely young', () => {
    const { baseline: _b, ...none } = ready;
    expect(baselineReadiness({ ...none, baselineCollection: { pendingCount: 0 } })).toMatchObject({
      state: 'no_control',
      pending: 0,
    });
    expect(
      baselineReadiness({ ...none, baselineCollection: { pendingCount: 143, oldestPendingAgeDays: 2.1 } }),
    ).toMatchObject({ state: 'no_control', pending: 143, oldestPendingAgeDays: 2.1 });
  });

  it('reports an unsent count as unknown, not as zero', () => {
    // An API predating the field has not told us the count is zero, and
    // "nothing recorded" is an alarm about a broken pipeline. Both counts
    // are pinned: a deploy that sends pendingCount without pricedCount is
    // a real intermediate state, and reading the absent one as 0 would
    // assert a fact the server never sent.
    const { baseline: _b, ...none } = ready;
    expect(baselineReadiness(none)).toMatchObject({ state: 'no_control', pending: null, priced: null });
    expect(baselineReadiness({ ...none, baselineCollection: { pendingCount: 12 } })).toMatchObject({
      state: 'no_control',
      pending: 12,
      priced: null,
    });
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
    expect(out).toMatch(/Chưa đủ kết quả/);
    expect(out).toMatch(/6\/20/);
    // The whole point of the threshold: a hit rate off six outcomes reads
    // like a finding. It must not appear at all.
    expect(out).not.toMatch(/thắng ròng/);
  });

  it('names the scanner as the empty side when the control already has outcomes', () => {
    // The performance block is not built when the scanner has no outcomes,
    // so a report reading only pendingCount announced "no control has
    // matured yet" while priced controls sat in the table — blaming the
    // wrong half.
    const { baseline: _b, ...none } = ready;
    const out = text({ ...none, baselineCollection: { pendingCount: 140, pricedCount: 3, oldestPendingAgeDays: 6 } });
    expect(out).toMatch(/đối chứng đã có 3 kết quả/);
    expect(out).toMatch(/Bên thiếu là scanner/);
    expect(out).not.toMatch(/chưa con nào tới hạn/);
  });

  it('tells a young control apart from a broken one, and says which', () => {
    const { baseline: _b, ...none } = ready;

    const young = text({ ...none, baselineCollection: { pendingCount: 143, pricedCount: 0, oldestPendingAgeDays: 2.1 } });
    expect(young).toMatch(/143 token bị loại/);
    expect(young).toMatch(/2\.1 ngày/);
    expect(young).toMatch(/Đang chạy đúng/);

    const broken = text({ ...none, baselineCollection: { pendingCount: 0, pricedCount: 0 } });
    expect(broken).toMatch(/Chưa ghi được token bị loại nào/);
    expect(broken).toMatch(/là hỏng, không phải chờ/);
    // The two must never be captioned the same way — that is the bug.
    expect(broken).not.toMatch(/Đang chạy đúng/);
  });

  it('says a losing scanner should be switched off, not retuned', () => {
    const out = text({ ...ready, baseline: { ...ready.baseline!, verdict: 'worse', deltaPp: -9 } });
    expect(out).toMatch(/THUA đám nó loại/);
    expect(out).toMatch(/tắt alert gem/);
    expect(out).toMatch(/không phải chỉnh lại trọng số/);
  });

  it('does not read an inconclusive result as evidence of no edge', () => {
    const out = text({ ...ready, baseline: { ...ready.baseline!, verdict: 'indistinguishable', deltaPp: 2 } });
    expect(out).toMatch(/chưa có bằng chứng cho cả hai chiều/);
  });

  it('warns when the control is really one rejection reason wearing a market costume', () => {
    const out = text({
      ...ready,
      baseline: { ...ready.baseline!, sampleCount: 50, failureCounts: { extreme_pump: 40, thin_volume: 3 } },
    });
    expect(out).toMatch(/80% nhóm đối chứng bị loại vì/);
    expect(out).toMatch(/hẹp hơn nhiều so với/);
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
    expect(out).toMatch(/THUA đám nó loại/);
    expect(out).toMatch(/68% nhóm đối chứng bị loại vì/);
    expect(out).not.toMatch(/Scanner thắng đám nó loại/);
  });

  it('stays quiet about concentration when the control is mixed', () => {
    expect(text(ready)).not.toMatch(/nhóm đối chứng bị loại vì/);
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
    expect(out).toMatch(/chưa có/);
    expect(out).not.toMatch(/mới coi là thật/);
  });
});
