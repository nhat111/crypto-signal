import { describe, expect, it } from 'vitest';
import { readMarketStructure } from './structure.js';
import type { OhlcvBar } from './technicals.js';

const DAY = 86_400_000;
const bars = (rows: Array<[number, number, number, number]>): OhlcvBar[] =>
  rows.map(([open, high, low, close], i) => ({ openTime: i * DAY, open, high, low, close, volume: 1 }));

/** The TA guide's TREND_BREAK figure: higher highs and lows, then a lower high, then a close under the last low. */
const GUIDE = bars([
  [100, 104, 99, 103],
  [103, 108, 102, 107],
  [107, 112, 106, 110],
  [110, 111, 105, 106],
  [106, 107, 102, 103],
  [103, 109, 102.5, 108],
  [108, 116, 107, 115],
  [115, 116, 109, 110],
  [110, 111, 106, 107],
  [107, 113, 106.5, 112],
  [112, 114, 110, 111],
  [111, 112, 107, 108],
  [108, 109, 103, 104],
]);

describe('readMarketStructure', () => {
  it('reads higher highs and higher lows as up', () => {
    // Stop before the lower high forms: pivots 112 → 116 and 102 → 106.
    const s = readMarketStructure(GUIDE.slice(0, 11), { emaPeriod: 5, width: 2 });
    expect(s?.trend).toBe('up');
    expect(s?.event).toBeNull();
    expect(s?.swingLows.map((p) => p.price)).toEqual([102, 106]);
  });

  it('calls a lower high under rising lows a warning, not a break', () => {
    const s = readMarketStructure(
      bars([...GUIDE.slice(0, 12).map((b) => [b.open, b.high, b.low, b.close] as [number, number, number, number]), [108, 110, 107, 109], [109, 110, 107.5, 108]]),
      { emaPeriod: 5, width: 2 },
    );
    expect(s?.trend).toBe('sideways');
    expect(s?.event).toBeNull();
    expect(s?.reasons.join(' ')).toMatch(/cảnh báo/);
  });

  it('breaks on the close under the last higher low — the guide’s verdict', () => {
    // Two more bars so the lower high at 114 is a confirmed pivot.
    const withTail = bars([
      ...GUIDE.map((b) => [b.open, b.high, b.low, b.close] as [number, number, number, number]),
      [104, 106, 101, 102],
    ]);
    const s = readMarketStructure(withTail, { emaPeriod: 5, width: 2 });
    expect(s?.event).toBe('up_broken');
    expect(s?.trend).toBe('sideways');
    expect(s?.reasons.join(' ')).toMatch(/dưới đáy gần nhất 106/);
  });

  it('does not break on a wick — only closes are compared', () => {
    const wick = bars([
      ...GUIDE.slice(0, 11).map((b) => [b.open, b.high, b.low, b.close] as [number, number, number, number]),
      [111, 112, 104, 110],
    ]);
    const s = readMarketStructure(wick, { emaPeriod: 5, width: 2 });
    expect(s?.event).toBeNull();
  });

  it('returns null without two swings on each side, and no EMA without enough bars', () => {
    expect(readMarketStructure(GUIDE.slice(0, 5), { width: 2 })).toBeNull();
    expect(readMarketStructure(GUIDE.slice(0, 11), { width: 2 })?.ema).toBeNull();
  });

  it('mirrors for a downtrend and its break', () => {
    const inverted = (b: OhlcvBar): [number, number, number, number] => [200 - b.open, 200 - b.low, 200 - b.high, 200 - b.close];
    const down = bars(GUIDE.slice(0, 11).map(inverted));
    expect(readMarketStructure(down, { emaPeriod: 5, width: 2 })?.trend).toBe('down');
    const broken = bars([...GUIDE.map(inverted), inverted({ openTime: 0, open: 104, high: 106, low: 101, close: 102, volume: 1 })]);
    expect(readMarketStructure(broken, { emaPeriod: 5, width: 2 })?.event).toBe('down_broken');
  });
});
