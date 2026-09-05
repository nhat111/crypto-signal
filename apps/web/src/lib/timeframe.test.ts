import { describe, expect, it } from 'vitest';
import { PREFERRED_OVERVIEW_TIMEFRAME, pickOverviewTimeframe } from './timeframe';
import type { Timeframe } from './types';

describe('pickOverviewTimeframe', () => {
  const all = ['5m', '15m', '1h', '4h'] as Timeframe[];

  it('honours what the reader chose', () => {
    expect(pickOverviewTimeframe('15m', all)).toBe('15m');
    expect(pickOverviewTimeframe('5m', all)).toBe('5m');
  });

  it('defaults to the slow frame, not the fast one', () => {
    // The whole reason this stopped being a constant: the cards headlined
    // 5m, which flips several times inside a single decision, and it
    // disagreed with whatever the Telegram bot was set to.
    expect(pickOverviewTimeframe(null, all)).toBe('4h');
    expect(PREFERRED_OVERVIEW_TIMEFRAME).toBe('4h');
  });

  it('never returns a frame the API does not serve', () => {
    // A stored preference for a frame later dropped from TIMEFRAMES would
    // match no row and leave every card empty — which reads as "no data"
    // rather than "that frame is gone".
    const collected = ['5m', '15m'] as Timeframe[];
    expect(collected).toContain(pickOverviewTimeframe('4h', collected));
    expect(collected).toContain(pickOverviewTimeframe('nonsense', collected));
    expect(collected).toContain(pickOverviewTimeframe(null, collected));
  });

  it('falls back to the slowest frame on offer when the preferred one is gone', () => {
    expect(pickOverviewTimeframe(null, ['5m', '15m'] as Timeframe[])).toBe('15m');
  });

  it('answers before the API has said anything', () => {
    // First render, overview still loading: an empty list must not produce
    // undefined and blank out the picker.
    expect(pickOverviewTimeframe(null, [])).toBe(PREFERRED_OVERVIEW_TIMEFRAME);
    expect(pickOverviewTimeframe('15m', [])).toBe(PREFERRED_OVERVIEW_TIMEFRAME);
  });
});
