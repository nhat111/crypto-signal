import { describe, expect, it } from 'vitest';
import { computeStablecoinFlow, type StablecoinSupplyPoint } from './stablecoinFlow.js';

/** Builds a daily series ending on `endDay`, oldest first. */
function series(endDay: string, values: number[]): StablecoinSupplyPoint[] {
  const endMs = Date.parse(`${endDay}T00:00:00Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  return values.map((totalCirculatingUsd, i) => ({
    day: new Date(endMs - (values.length - 1 - i) * dayMs).toISOString().slice(0, 10),
    totalCirculatingUsd,
  }));
}

describe('computeStablecoinFlow', () => {
  it('returns null for an empty series rather than a zeroed reading', () => {
    expect(computeStablecoinFlow([])).toBeNull();
  });

  it('reports the latest value and the day it is as of', () => {
    const flow = computeStablecoinFlow(series('2026-03-10', [100, 110]));
    expect(flow!.latestUsd).toBe(110);
    expect(flow!.asOfDay).toBe('2026-03-10');
  });

  it('computes a positive 7d change against the day 7 back', () => {
    // 8 points: day -7 = 100, latest = 110.
    const flow = computeStablecoinFlow(series('2026-03-10', [100, 101, 102, 103, 104, 105, 106, 110]));
    expect(flow!.change7d!.fromDay).toBe('2026-03-03');
    expect(flow!.change7d!.changeUsd).toBe(10);
    expect(flow!.change7d!.changePct).toBeCloseTo(10, 5);
  });

  it('reports a negative change when supply shrank — money leaving, not a floor at zero', () => {
    const flow = computeStablecoinFlow(series('2026-03-10', [200, 199, 198, 197, 196, 195, 194, 180]));
    expect(flow!.change7d!.changeUsd).toBe(-20);
    expect(flow!.change7d!.changePct).toBeCloseTo(-10, 5);
  });

  it('returns null for a window the history cannot cover, instead of a shortened one', () => {
    // Only 3 days of history — a "7d change" here would really be a 2d change.
    const flow = computeStablecoinFlow(series('2026-03-10', [100, 105, 110]));
    expect(flow!.change7d).toBeNull();
    expect(flow!.change30d).toBeNull();
    expect(flow!.latestUsd).toBe(110);
  });

  it('measures over at least the requested span when days are missing, never less', () => {
    // Gap: nothing between 03-01 and 03-10, so the 7d window falls back to 03-01 (9 days).
    const points: StablecoinSupplyPoint[] = [
      { day: '2026-03-01', totalCirculatingUsd: 100 },
      { day: '2026-03-10', totalCirculatingUsd: 120 },
    ];
    const flow = computeStablecoinFlow(points);
    expect(flow!.change7d!.fromDay).toBe('2026-03-01');
    expect(flow!.change7d!.changeUsd).toBe(20);
  });

  it('computes the 30d window independently of the 7d one', () => {
    const values = Array.from({ length: 31 }, (_, i) => 100 + i);
    const flow = computeStablecoinFlow(series('2026-03-31', values));
    expect(flow!.change30d!.changeUsd).toBe(30);
    expect(flow!.change7d!.changeUsd).toBe(7);
  });
});
