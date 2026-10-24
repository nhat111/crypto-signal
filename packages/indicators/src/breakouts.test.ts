import { describe, expect, it } from 'vitest';
import { breakoutResult, detectBreakout, readBreakoutRegime, stepBreakout } from './breakouts.js';
import type { OhlcvBar } from './technicals.js';

const DAY = 86_400_000;
const bar = (i: number, o: number, h: number, l: number, c: number): OhlcvBar => ({ openTime: i * DAY, open: o, high: h, low: l, close: c, volume: 1 });
/** `n` daily bars rising slowly from `from`, each 2 wide — enough history for EMA200 to sit below. */
const rising = (n: number, from = 50, step = 0.1): OhlcvBar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = from + i * step;
    return bar(i, c, c + 1, c - 1, c);
  });

describe('readBreakoutRegime', () => {
  it('is up when the close and EMA50 are both above EMA200', () => {
    expect(readBreakoutRegime(rising(260))?.up).toBe(true);
  });
  it('is down in a falling market and null without 200 bars', () => {
    expect(readBreakoutRegime(rising(260, 100, -0.1))?.up).toBe(false);
    expect(readBreakoutRegime(rising(150))).toBeNull();
  });
});

describe('detectBreakout', () => {
  const base = rising(240);
  const prevHigh = Math.max(...base.slice(-20).map((b) => b.high));

  it('takes a close above the prior 20-day high, stop at the 10-day low', () => {
    const c = prevHigh + 2;
    const s = detectBreakout([...base, bar(240, c - 1, c + 0.5, c - 1.5, c)]);
    expect(s?.entry).toBe(c);
    expect(s?.high20).toBe(prevHigh);
    const lows = [...base.slice(-9), bar(240, 0, 0, c - 1.5, 0)].map((b) => b.low);
    expect(s?.stop).toBe(Math.min(...lows));
    expect(s!.stopPct).toBeGreaterThan(0);
  });

  it('ignores a close that only wicked above the high', () => {
    expect(detectBreakout([...base, bar(240, prevHigh, prevHigh + 3, prevHigh - 1, prevHigh - 0.5)])).toBeNull();
  });

  it('needs the coin above its own EMA200', () => {
    const falling = rising(240, 100, -0.1);
    const spike = falling[falling.length - 1]!.close + 2;
    expect(detectBreakout([...falling, bar(240, spike, spike, spike - 1, spike)])).toBeNull();
  });
});

describe('stepBreakout', () => {
  // Entry at bar 10 (close 100), stop 90; lows before it at 95.
  const pre = Array.from({ length: 11 }, (_, i) => bar(i, 100, 101, 95, 100));
  const pos = { barOpenTime: 10 * DAY, stop: 90 };

  it('stays open while nothing is broken, raising the trail with the prior 10 lows', () => {
    const after = [bar(11, 100, 106, 99, 105), bar(12, 105, 111, 104, 110)];
    const s = stepBreakout(pos, [...pre, ...after]);
    expect(s.status).toBe('open');
    expect(s.trail).toBe(95);
  });

  it('exits at the stop, or at the open when the day gapped under it', () => {
    expect(stepBreakout(pos, [...pre, bar(11, 99, 100, 89, 92)])).toMatchObject({ status: 'stop', exitPrice: 90 });
    expect(stepBreakout(pos, [...pre, bar(11, 85, 86, 80, 82)])).toMatchObject({ status: 'stop', exitPrice: 85 });
  });

  it('exits on a close under the trail, at that close', () => {
    // Ten higher bars lift the trail to 110; a close at 108 is out.
    const up = Array.from({ length: 10 }, (_, k) => bar(11 + k, 115, 121, 110, 120));
    const s = stepBreakout(pos, [...pre, ...up, bar(21, 115, 116, 107, 108)]);
    expect(s).toMatchObject({ status: 'trail', exitPrice: 108, trail: 110 });
  });
});

describe('breakoutResult', () => {
  it('nets both fees and scales by the planned risk', () => {
    const { returnPct, r } = breakoutResult(100, 90, 120);
    expect(returnPct).toBeCloseTo((120 * 0.999) / (100 * 1.001) * 100 - 100, 6);
    expect(r).toBeCloseTo(returnPct / 10, 6);
    expect(breakoutResult(100, 90, 90).r).toBeLessThan(-1);
  });
});
