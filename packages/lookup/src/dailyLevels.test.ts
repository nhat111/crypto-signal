import { describe, expect, it } from 'vitest';
import type { OhlcvBar } from '@crypto-signal/indicators';
import { readDailyLevels } from './dailyLevels.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 21, 12);

/** A zigzag: 6 days up, 4 down, drifting by `drift` a day. Up drift = higher highs and higher lows. */
function zigzag(days: number, drift: number, start = 100): OhlcvBar[] {
  const bars: OhlcvBar[] = [];
  let price = start;
  for (let i = 0; i < days; i += 1) {
    price += drift + (i % 10 < 6 ? 2 : -2.5);
    const openTime = NOW - (days - i) * DAY - 12 * 3_600_000;
    bars.push({ openTime, open: price, high: price + 1, low: price - 1, close: price, volume: 1000 });
  }
  return bars;
}

describe('readDailyLevels', () => {
  it('reads an uptrend above EMA200 into both setups to watch', () => {
    const bars = zigzag(300, 0.6);
    const last = (bars[bars.length - 1] as OhlcvBar).close;
    const r = readDailyLevels(bars, last, NOW);
    expect(r?.trend).toBe('up');
    expect(r?.aboveEma).toBe(true);
    expect(r?.swingLow?.price).toBeLessThan(last);
    expect(r?.swingLow?.distancePct).toBeLessThan(0);
    expect(r?.watch.join(' | ')).toContain('Hồi về đáy: chờ nến 4H chạm vùng quanh');
    expect(r?.watch.join(' | ')).toMatch(/Phá đỉnh|đỉnh 1D/);
  });

  it('says the setups are off below EMA200', () => {
    const bars = zigzag(300, -0.9, 500);
    const r = readDailyLevels(bars, (bars[bars.length - 1] as OhlcvBar).close, NOW);
    expect(r?.aboveEma).toBe(false);
    expect(r?.watch).toHaveLength(1);
    expect(r?.watch[0]).toContain('dưới EMA200');
  });

  it("ignores today's unclosed bar and needs enough history", () => {
    const bars = zigzag(300, 0.6);
    const withOpen = [...bars, { ...(bars[bars.length - 1] as OhlcvBar), openTime: NOW - 3_600_000, close: 1 }];
    expect(readDailyLevels(withOpen, 200, NOW)?.swingLow).toEqual(readDailyLevels(bars, 200, NOW)?.swingLow);
    expect(readDailyLevels(zigzag(20, 0.6), 100, NOW)).toBeNull();
  });
});
