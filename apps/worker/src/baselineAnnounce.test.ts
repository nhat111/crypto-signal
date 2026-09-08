import { describe, expect, it } from 'vitest';
import type { BaselineReportInput } from '@crypto-signal/shared';
import { decideAnnouncement } from './baselineAnnounce.js';

const ready = (verdict: 'beats' | 'worse' | 'indistinguishable'): BaselineReportInput => ({
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
    verdict,
    medianDeltaPp: 6,
  },
});

describe('when to announce the baseline verdict', () => {
  it('says nothing while the data cannot answer the question', () => {
    const thin: BaselineReportInput = { ...ready('beats'), sampleCount: 4, sufficientData: false };
    expect(decideAnnouncement(thin, undefined)).toEqual({ send: false, why: 'not_ready' });
  });

  it('announces the first verdict there is', () => {
    expect(decideAnnouncement(ready('beats'), undefined)).toEqual({
      send: true,
      why: 'first_verdict',
      verdict: 'beats',
    });
  });

  it('stays silent while the verdict holds', () => {
    // The anti-spam rule. A verdict repeated hourly is one the reader
    // learns to skip, and then the one that matters gets skipped too.
    expect(decideAnnouncement(ready('beats'), 'beats')).toEqual({ send: false, why: 'unchanged' });
  });

  it('announces a flip from beats to worse — the message that matters most', () => {
    expect(decideAnnouncement(ready('worse'), 'beats')).toEqual({
      send: true,
      why: 'verdict_changed',
      verdict: 'worse',
    });
  });

  it('announces a flip in either direction, including back to inconclusive', () => {
    expect(decideAnnouncement(ready('indistinguishable'), 'worse').send).toBe(true);
    expect(decideAnnouncement(ready('beats'), 'indistinguishable').send).toBe(true);
  });

  it('does not re-announce merely because more samples arrived', () => {
    // Sample growth is already priced into the verdict through its margin.
    // Re-sending for it would be noise wearing the shape of news.
    const bigger = { ...ready('beats'), sampleCount: 400 };
    expect(decideAnnouncement(bigger, 'beats')).toEqual({ send: false, why: 'unchanged' });
  });

  it('goes quiet again if the data stops supporting a verdict', () => {
    // Losing sufficiency should not fire a "changed" message — there is no
    // new verdict, only less to say.
    const lost: BaselineReportInput = { ...ready('beats'), sufficientData: false };
    expect(decideAnnouncement(lost, 'beats')).toEqual({ send: false, why: 'not_ready' });
  });

  it('treats a missing control as not ready, not as a verdict of zero', () => {
    const { baseline: _b, ...noControl } = ready('beats');
    expect(decideAnnouncement(noControl, undefined)).toEqual({ send: false, why: 'not_ready' });
  });
});
