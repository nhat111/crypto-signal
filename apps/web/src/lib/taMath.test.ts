import { describe, expect, it } from 'vitest';
import { atr, ema, rsi, trueRange } from './taMath';

describe('ema', () => {
  it('is undefined until it has a full period, rather than averaging what it has', () => {
    // A 5-candle average of 3 candles is not a 5-candle average, and a
    // line that starts early is a line that lies about its own memory.
    const out = ema([1, 2, 3, 4, 5, 6], 5);
    expect(out.slice(0, 4)).toEqual([null, null, null, null]);
    expect(out[4]).toBeCloseTo(3, 10);
  });

  it('sits exactly on a flat series', () => {
    expect(ema([10, 10, 10, 10, 10], 3).at(-1)).toBeCloseTo(10, 10);
  });

  it('lags: a longer period reacts less to the same jump', () => {
    // This is the whole reason the guide draws two of them.
    const closes = [10, 10, 10, 10, 10, 10, 10, 10, 20, 20, 20];
    const fast = ema(closes, 3).at(-1) as number;
    const slow = ema(closes, 9).at(-1) as number;
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThan(20);
  });
});

describe('rsi', () => {
  it('reaches 100 when nothing falls, and stays there', () => {
    // The reading the guide exists to explain: RSI over 70 in a strong
    // trend is not a sell signal, it is what a strong trend looks like.
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(rising).at(-1)).toBe(100);
  });

  it('reaches 0 when nothing rises', () => {
    const falling = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(falling).at(-1)).toBe(0);
  });

  it('hovers around 50 when gains and losses balance', () => {
    // Not exactly 50: Wilder smoothing tilts with the most recent change,
    // so a balanced chop ends slightly above 50 after an up-tick and
    // slightly below after a down-tick. What matters is that it stays in a
    // tight band, nowhere near the extremes the trends above produce.
    const chop = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    const tail = rsi(chop).slice(-10) as number[];
    for (const value of tail) {
      expect(value).toBeGreaterThan(45);
      expect(value).toBeLessThan(55);
    }
  });

  it('has no value until there are enough changes to average', () => {
    const out = rsi([1, 2, 3, 4, 5], 14);
    expect(out.every((v) => v === null)).toBe(true);
  });
});

describe('trueRange', () => {
  it('is the bar span when there is no previous close', () => {
    expect(trueRange({ high: 110, low: 100, close: 105 }, undefined)).toBe(10);
  });

  it('widens to include a gap from the previous close', () => {
    // Without this an overnight gap reads as a calm bar, and a stop sized
    // from it is far too tight.
    expect(trueRange({ high: 110, low: 105, close: 108 }, 90)).toBe(20);
  });
});

describe('atr', () => {
  it('is null until the window is full', () => {
    const bars = [
      { high: 2, low: 1, close: 1.5 },
      { high: 2, low: 1, close: 1.5 },
    ];
    expect(atr(bars, 3)).toEqual([null, null]);
  });

  it('averages the true ranges over the window', () => {
    const bars = Array.from({ length: 5 }, () => ({ high: 12, low: 10, close: 11 }));
    // First bar's range is 2; every later bar gaps from close 11 to high
    // 12 / low 10, so the true range stays 2.
    expect(atr(bars, 3).at(-1)).toBeCloseTo(2, 10);
  });

  it('rises when the bars get wider', () => {
    const calm = Array.from({ length: 6 }, () => ({ high: 101, low: 100, close: 100.5 }));
    const wild = Array.from({ length: 6 }, () => ({ high: 110, low: 100, close: 105 }));
    const calmAtr = atr(calm, 3).at(-1) as number;
    const wildAtr = atr(wild, 3).at(-1) as number;
    expect(wildAtr).toBeGreaterThan(calmAtr * 5);
  });
});
