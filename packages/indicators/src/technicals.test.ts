import { describe, expect, it } from 'vitest';
import { computeAtr, computeAtrPct, computeTrueRange } from './volatility.js';
import {
  TREND_DEADBAND_PCT,
  atrPctSeries,
  percentileOf,
  rsiSeries,
  volumeVsAverage,
  windowExtremes,
  changePctOver,
  computeEma,
  computeRsi,
  findSwingLevels,
  rangePosition,
  readTrend,
  type OhlcvBar,
} from './technicals.js';

const bar = (openTime: number, high: number, low: number, close = (high + low) / 2): OhlcvBar => ({
  openTime,
  open: close,
  high,
  low,
  close,
  volume: 1,
});

describe('computeEma', () => {
  it('is the flat value itself when nothing moves', () => {
    expect(computeEma([10, 10, 10, 10, 10], 3)).toBeCloseTo(10, 10);
  });

  it('matches a hand-computed run', () => {
    // Seed = mean(1,2,3) = 2; k = 2/4 = 0.5.
    // step 4: 4*0.5 + 2*0.5   = 3
    // step 5: 5*0.5 + 3*0.5   = 4
    expect(computeEma([1, 2, 3, 4, 5], 3)).toBeCloseTo(4, 10);
  });

  it('weights recent values more than old ones', () => {
    const rising = computeEma([1, 1, 1, 1, 10], 3) as number;
    const simpleMean = (1 + 1 + 1 + 1 + 10) / 5;
    expect(rising).toBeGreaterThan(simpleMean);
  });

  it('refuses rather than guessing when the window is too short', () => {
    // An EMA over fewer points than its period is not a weak EMA; it is
    // not one, and a number here could not be told apart from a real read.
    expect(computeEma([1, 2], 5)).toBeNull();
    expect(computeEma([], 5)).toBeNull();
    expect(computeEma([1, 2, 3], 0)).toBeNull();
  });

  it('works when the window is exactly the period', () => {
    expect(computeEma([2, 4, 6], 3)).toBeCloseTo(4, 10);
  });
});

describe('computeRsi', () => {
  it('is 100 for a run with no down closes', () => {
    // By definition, not a special case: avgLoss of zero is a real state.
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(computeRsi(closes)).toBe(100);
  });

  it('is 0 for a run with no up closes', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(computeRsi(closes)).toBeCloseTo(0, 6);
  });

  it('is 50 when price never moves at all', () => {
    // Both averages zero. Reporting 100 there would say "maximum strength"
    // about a flat line.
    expect(computeRsi(Array(20).fill(100))).toBe(50);
  });

  it('sits mid-range for an evenly alternating series', () => {
    const closes = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    const rsi = computeRsi(closes) as number;
    expect(rsi).toBeGreaterThan(35);
    expect(rsi).toBeLessThan(65);
  });

  it('lets an old spike decay instead of holding the reading up forever', () => {
    // A big early gain, then a long two-sided drift. The spike has to stop
    // mattering; a plain average of gains and losses would keep it in the
    // window at full weight until it fell off the end.
    const drift = Array.from({ length: 60 }, (_, i) => 130 + (i % 2 === 0 ? -1 : 1));
    const soonAfter = computeRsi([100, 130, ...drift.slice(0, 15)]) as number;
    const longAfter = computeRsi([100, 130, ...drift]) as number;
    expect(soonAfter).toBeGreaterThan(longAfter);
    expect(longAfter).toBeLessThan(70);
  });

  it('reports 100 for a run that genuinely never closed down', () => {
    // Not a bug to smooth away: with zero down-closes the average loss is
    // zero, and RSI is 100 by definition.
    expect(computeRsi([100, 130, ...Array(40).fill(130)])).toBe(100);
  });

  it('needs period + 1 closes, because one close is not a change', () => {
    expect(computeRsi(Array(14).fill(100), 14)).toBeNull();
    expect(computeRsi(Array(15).fill(100), 14)).not.toBeNull();
    expect(computeRsi([100, 101], 14)).toBeNull();
  });
});

describe('readTrend', () => {
  const rising = Array.from({ length: 120 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 120 }, (_, i) => 300 - i);

  it('calls a sustained rise up and a sustained fall down', () => {
    expect(readTrend(rising)?.direction).toBe('up');
    expect(readTrend(falling)?.direction).toBe('down');
  });

  it('calls a flat line sideways rather than flipping on noise', () => {
    // Without the deadband, two averages a hundredth of a percent apart
    // would read as a trend and the label would flicker.
    expect(readTrend(Array(120).fill(100))?.direction).toBe('sideways');
  });

  it('treats separation inside the deadband as sideways', () => {
    const read = readTrend(rising);
    expect(read).not.toBeNull();
    expect(Math.abs((read as { separationPct: number }).separationPct)).toBeGreaterThan(TREND_DEADBAND_PCT);
  });

  it('refuses when there is not enough history for the slow average', () => {
    expect(readTrend(Array.from({ length: 30 }, (_, i) => i), 20, 50)).toBeNull();
  });

  it('reports both averages, so the label can be checked against them', () => {
    const read = readTrend(rising);
    expect(read?.fastEma).toBeGreaterThan(read?.slowEma as number);
  });
});

describe('findSwingLevels', () => {
  // A clear zig-zag: pivot high at 120, pivot low at 80.
  const bars: OhlcvBar[] = [
    bar(1, 100, 95),
    bar(2, 105, 96),
    bar(3, 120, 110),
    bar(4, 108, 98),
    bar(5, 104, 80),
    bar(6, 106, 90),
    bar(7, 118, 100),
    bar(8, 112, 99),
    bar(9, 111, 97),
  ];

  it('finds the NEAREST level on each side, not the most extreme', () => {
    // There are pivot highs at both 120 and 118. The one that matters to
    // a buyer at 105 is 118 — the far level is not what the next move
    // runs into first.
    const levels = findSwingLevels(bars, 105, 2);
    expect(levels.resistance).toBe(118);
    expect(levels.support).toBe(80);
  });

  it('says null rather than inventing a level price has already passed', () => {
    // Above every pivot high there is no resistance to name, and claiming
    // one would put a number on a chart that is not there.
    expect(findSwingLevels(bars, 1_000, 2).resistance).toBeNull();
    expect(findSwingLevels(bars, 1, 2).support).toBeNull();
  });

  it('reports how many pivots it found, so a thin sample is visible', () => {
    // Two candles do not make a level; the count is what lets a caller
    // decide whether to show one.
    expect(findSwingLevels(bars, 105, 2).pivotCount).toBeGreaterThan(0);
    expect(findSwingLevels([bar(1, 10, 5), bar(2, 11, 6)], 8, 2).pivotCount).toBe(0);
  });

  it('needs a bar to beat its neighbours on both sides', () => {
    // A monotonic series has no pivots at all — the last bar is highest
    // but has nothing to its right.
    const climbing = Array.from({ length: 10 }, (_, i) => bar(i, 100 + i, 90 + i));
    expect(findSwingLevels(climbing, 105, 2).pivotCount).toBe(0);
  });
});

describe('changePctOver', () => {
  it('measures from the bar that many places back', () => {
    expect(changePctOver([100, 110, 120], 2)).toBeCloseTo(20, 10);
    expect(changePctOver([100, 110, 90], 1)).toBeCloseTo(-18.1818, 3);
  });

  it('refuses a window longer than the history', () => {
    expect(changePctOver([100, 110], 5)).toBeNull();
  });

  it('refuses to divide by a zero starting price', () => {
    expect(changePctOver([0, 110], 1)).toBeNull();
  });
});

describe('rangePosition', () => {
  const bars = [bar(1, 120, 80), bar(2, 110, 90)];

  it('is 0 at the bottom of the range and 100 at the top', () => {
    expect(rangePosition(bars, 80)).toBeCloseTo(0, 10);
    expect(rangePosition(bars, 120)).toBeCloseTo(100, 10);
    expect(rangePosition(bars, 100)).toBeCloseTo(50, 10);
  });

  it('clamps a price outside the window instead of returning >100', () => {
    // The reference can be the live price while the bars are closed ones.
    expect(rangePosition(bars, 500)).toBe(100);
    expect(rangePosition(bars, 1)).toBe(0);
  });

  it('refuses when there is no range to be positioned inside', () => {
    expect(rangePosition([], 100)).toBeNull();
    expect(rangePosition([bar(1, 100, 100)], 100)).toBeNull();
  });
});

describe('rsiSeries', () => {
  it('gives one reading per bar that has enough history behind it', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + (i % 3));
    // 40 closes, period 14 → 39 changes, first reading after 14 of them.
    expect(rsiSeries(closes, 14)).toHaveLength(40 - 14);
  });

  it('ends on the same value computeRsi reports', () => {
    // The series and the single reading must not drift; the whole point of
    // the series is placing that one value in its own distribution.
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 10);
    const series = rsiSeries(closes, 14);
    expect(series[series.length - 1]).toBeCloseTo(computeRsi(closes, 14) as number, 9);
  });

  it('omits the warm-up bars rather than zero-filling them', () => {
    // Padding with zeros would drag every percentile toward the bottom and
    // make ordinary readings look extreme.
    expect(rsiSeries(Array(14).fill(100), 14)).toEqual([]);
    expect(rsiSeries(Array(20).fill(100), 14).every((v) => v === 50)).toBe(true);
  });
});

describe('atrPctSeries', () => {
  it('ends on the same value the single ATR% computation gives', () => {
    const bars = Array.from({ length: 60 }, (_, i) => bar(i, 100 + i + 2, 100 + i - 2, 100 + i));
    const series = atrPctSeries(bars, 14);
    const ranges = bars.map((b, i) => computeTrueRange(b, i === 0 ? undefined : (bars[i - 1] as OhlcvBar).close));
    const expected = computeAtrPct(computeAtr(ranges.slice(-14)), bars[bars.length - 1]?.close as number);
    expect(series[series.length - 1]).toBeCloseTo(expected, 6);
  });

  it('returns nothing when there is not a full window', () => {
    expect(atrPctSeries(Array.from({ length: 10 }, (_, i) => bar(i, 10, 9)), 14)).toEqual([]);
  });
});

describe('percentileOf', () => {
  it('places a value inside its own distribution', () => {
    expect(percentileOf(5, [1, 2, 3, 4, 5])).toBe(100);
    expect(percentileOf(1, [1, 2, 3, 4, 5])).toBe(20);
    expect(percentileOf(3, [1, 2, 3, 4, 5])).toBe(60);
  });

  it('counts a value above everything as the top', () => {
    expect(percentileOf(99, [1, 2, 3])).toBe(100);
    expect(percentileOf(0, [1, 2, 3])).toBe(0);
  });

  it('says nothing rather than "average" when there is no history', () => {
    // 50 would be a measurement; null is the truth.
    expect(percentileOf(5, [])).toBeNull();
  });
});

describe('windowExtremes', () => {
  const bars = [bar(1, 120, 100), bar(2, 118, 90), bar(3, 115, 95), bar(4, 116, 99)];

  it('finds both extremes with how long ago and how far', () => {
    const ext = windowExtremes(bars, 110);
    expect(ext?.high.price).toBe(120);
    expect(ext?.high.barsAgo).toBe(3);
    expect(ext?.high.distancePct).toBeCloseTo(9.0909, 3);
    expect(ext?.low.price).toBe(90);
    expect(ext?.low.barsAgo).toBe(2);
    expect(ext?.low.distancePct).toBeCloseTo(-18.1818, 3);
  });

  it('reports zero bars ago when the extreme is the latest bar', () => {
    const climbing = [bar(1, 100, 90), bar(2, 110, 95), bar(3, 130, 99)];
    expect(windowExtremes(climbing, 120)?.high.barsAgo).toBe(0);
  });

  it('refuses rather than dividing by a zero reference', () => {
    expect(windowExtremes(bars, 0)).toBeNull();
    expect(windowExtremes([], 100)).toBeNull();
  });
});

describe('volumeVsAverage', () => {
  const flat = (n: number, volume: number) =>
    Array.from({ length: n }, (_, i) => ({ ...bar(i, 10, 9), volume }));

  it('is 1 when the latest bar matches its baseline', () => {
    expect(volumeVsAverage(flat(30, 100), 20)).toBeCloseTo(1, 9);
  });

  it('excludes the latest bar from its own baseline', () => {
    // Including it would pull the average toward the very thing being
    // measured, and a genuine spike would read as smaller than it is.
    const bars = [...flat(20, 100), { ...bar(99, 10, 9), volume: 500 }];
    expect(volumeVsAverage(bars, 20)).toBeCloseTo(5, 9);
  });

  it('refuses when there is no baseline to compare against', () => {
    expect(volumeVsAverage(flat(5, 100), 20)).toBeNull();
    expect(volumeVsAverage(flat(30, 0), 20)).toBeNull();
  });
});
