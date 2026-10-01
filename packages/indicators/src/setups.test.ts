import { describe, expect, it } from 'vitest';
import { averageTrueRange, detectSetups, isRejection, resolveSetupOutcome } from './setups.js';
import type { MarketStructure } from './structure.js';
import type { OhlcvBar } from './technicals.js';

const H4 = 4 * 3_600_000;
const bar = (i: number, o: number, h: number, l: number, c: number, v = 100): OhlcvBar => ({ openTime: i * H4, open: o, high: h, low: l, close: c, volume: v });

function structure(over: Partial<MarketStructure> = {}): MarketStructure {
  return {
    trend: 'up',
    event: null,
    swingHighs: [{ openTime: 0, price: 110 }, { openTime: 1, price: 120 }],
    swingLows: [{ openTime: 0, price: 90 }, { openTime: 1, price: 100 }],
    lastClose: 105,
    lastCloseTime: 0,
    ema: 95,
    emaPeriod: 200,
    aboveEma: true,
    reasons: [],
    ...over,
  };
}

/** Daily bars with one clear pivot high at `peak`, used only to find the next resistance. */
function dailyWithPeak(peak: number): OhlcvBar[] {
  const rows = [100, 102, 104, peak - 2, peak, peak - 2, 104, 102, 101];
  return rows.map((p, i) => ({ openTime: i, open: p - 1, high: p, low: p - 2, close: p - 1, volume: 1 }));
}

/** 20 calm 4H bars around `mid` with ~2-point ranges, so ATR is about 2. */
const calm = (mid: number, n = 20, start = 0): OhlcvBar[] =>
  Array.from({ length: n }, (_, k) => bar(start + k, mid, mid + 1, mid - 1, mid + 0.2));

describe('isRejection', () => {
  it('wants a long lower wick and a close near the top', () => {
    expect(isRejection(bar(0, 101, 102, 97, 101.5))).toBe(true);
    expect(isRejection(bar(0, 101, 102, 97, 97.5))).toBe(false);
    expect(isRejection(bar(0, 101, 101, 101, 101))).toBe(false);
  });
});

describe('detectSetups — pullback', () => {
  const bars = [...calm(104), bar(20, 103, 103.5, 100.5, 103.2)];

  it('finds a rejection at the 1D swing low and prices the plan under the level', () => {
    const [s] = detectSetups({ structure: structure(), dailyBars: dailyWithPeak(130), bars4h: bars });
    expect(s?.kind).toBe('pullback');
    expect(s?.level).toBe(100);
    expect(s!.stop).toBeLessThan(100);
    expect(s?.entry).toBe(103.2);
    // The structure's own latest swing high, as the guide draws it.
    expect(s?.target).toBe(120);
    expect(s!.rr).toBeGreaterThanOrEqual(2);
    expect(s?.reasons.join(' ')).toMatch(/R:R 1:/);
  });

  it('drops it when the next resistance is too close for 1:2 — Ví dụ 3', () => {
    const close = structure({ swingHighs: [{ openTime: 0, price: 104 }, { openTime: 1, price: 106 }] });
    expect(detectSetups({ structure: close, dailyBars: dailyWithPeak(106), bars4h: bars })).toEqual([]);
  });

  it('drops it with no resistance above at all, rather than inventing a target', () => {
    const under = structure({ swingHighs: [{ openTime: 0, price: 101 }, { openTime: 1, price: 102 }] });
    expect(detectSetups({ structure: under, dailyBars: dailyWithPeak(102), bars4h: bars })).toEqual([]);
  });

  it('needs the 1D trend up and price above the EMA', () => {
    expect(detectSetups({ structure: structure({ trend: 'sideways' }), dailyBars: dailyWithPeak(130), bars4h: bars })).toEqual([]);
    expect(detectSetups({ structure: structure({ aboveEma: false }), dailyBars: dailyWithPeak(130), bars4h: bars })).toEqual([]);
  });
});

describe('detectSetups — breakout and retest', () => {
  const base = calm(118, 22);
  const breakout = bar(22, 119, 124, 118.5, 123, 400);
  const holding = [bar(23, 123, 125, 122, 124), bar(24, 124, 124.5, 121.5, 122.5)];
  const retest = bar(25, 121.5, 123.5, 120.5, 123);

  it('finds a high-volume close above the 1D high that comes back and holds', () => {
    const [s] = detectSetups({
      structure: structure(),
      dailyBars: dailyWithPeak(150),
      bars4h: [...base, breakout, ...holding, retest],
    });
    expect(s?.kind).toBe('breakout_retest');
    expect(s?.level).toBe(120);
    expect(s!.stop).toBeLessThan(120);
    expect(s?.reasons.join(' ')).toMatch(/khối lượng gấp 4\.0 lần/);
  });

  it('ignores a breakout on ordinary volume', () => {
    const weak = { ...breakout, volume: 120 };
    expect(
      detectSetups({ structure: structure(), dailyBars: dailyWithPeak(150), bars4h: [...base, weak, ...holding, retest] }),
    ).toEqual([]);
  });

  it('ignores it once a close fell back inside the old range — a failed breakout', () => {
    const failed = [bar(23, 123, 123, 118, 119), holding[1]!];
    expect(
      detectSetups({ structure: structure(), dailyBars: dailyWithPeak(150), bars4h: [...base, breakout, ...failed, retest] }),
    ).toEqual([]);
  });
});

describe('resolveSetupOutcome', () => {
  const setup = { stop: 98, target: 110, barOpenTime: 0 };
  it('scores whichever level was touched first, and a bar touching both as the stop', () => {
    expect(resolveSetupOutcome(setup, [bar(1, 100, 105, 99, 104), bar(2, 104, 111, 103, 110)]).outcome).toBe('target');
    expect(resolveSetupOutcome(setup, [bar(1, 100, 111, 97, 104)]).outcome).toBe('stop');
    expect(resolveSetupOutcome(setup, [bar(0, 100, 120, 90, 100), bar(1, 100, 101, 99, 100)]).outcome).toBe('open');
  });
});

describe('averageTrueRange', () => {
  it('returns null without period + 1 bars', () => {
    expect(averageTrueRange(calm(100, 14))).toBeNull();
    expect(averageTrueRange(calm(100, 15))).toBeCloseTo(2, 0);
  });
});
