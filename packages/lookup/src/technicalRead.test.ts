import { describe, expect, it } from 'vitest';
import { MIN_BARS_FOR_READ, buildTechnicalRead, describeTechnicalRead } from './technicalRead.js';
import type { OhlcvBar } from '@crypto-signal/indicators';

function series(closes: number[]): OhlcvBar[] {
  return closes.map((close, i) => ({
    openTime: i * 3_600_000,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 100,
  }));
}

const rising = series(Array.from({ length: 120 }, (_, i) => 100 + i));
const flat = series(Array(120).fill(100));

describe('buildTechnicalRead', () => {
  it('reports nothing at all for no history, rather than an empty read', () => {
    expect(buildTechnicalRead([])).toBeNull();
  });

  it('reads a long rising series as EMA20 above EMA50', () => {
    const read = buildTechnicalRead(rising);
    expect(read?.trend?.direction).toBe('up');
    expect(read?.lastPrice).toBe(219);
    expect(read?.barCount).toBe(120);
  });

  it('names what the history was too short for instead of leaving blanks', () => {
    // A null RSI and an RSI that happens to be missing look identical to a
    // reader; only the list tells them apart.
    const read = buildTechnicalRead(series([100, 101, 102, 103, 104]));
    expect(read?.rsi14).toBeNull();
    expect(read?.trend).toBeNull();
    expect(read?.missing.join(' ')).toContain('RSI 14');
    expect(read?.missing.join(' ')).toContain('EMA 20/50');
  });

  it('still reports the last price when everything else is unavailable', () => {
    // One bar is enough to say what it costs, and nothing else.
    const read = buildTechnicalRead(series([42]));
    expect(read?.lastPrice).toBe(42);
    expect(read?.rsi14).toBeNull();
    expect(read?.missing.length).toBeGreaterThan(2);
  });

  it('computes ATR% off the last 14 ranges once there are enough', () => {
    const read = buildTechnicalRead(rising);
    expect(read?.atrPct).not.toBeNull();
    expect(read?.atrPct as number).toBeGreaterThan(0);
  });

  it('leaves support and resistance null when no pivot has formed', () => {
    // A monotonic climb has no swing to draw a level from, and inventing
    // one would put a number on a chart that is not there.
    const read = buildTechnicalRead(rising);
    expect(read?.support).toBeNull();
    expect(read?.resistance).toBeNull();
    expect(read?.missing.join(' ')).toContain('Hỗ trợ/kháng cự');
  });

  it('finds levels on a series that actually swings', () => {
    const zigzag = series([100, 108, 120, 108, 90, 96, 118, 104, 99, 103, 111, 107]);
    const read = buildTechnicalRead(zigzag);
    expect(read?.support !== null || read?.resistance !== null).toBe(true);
  });

  it('reports a flat series as sideways rather than picking a direction', () => {
    expect(buildTechnicalRead(flat)?.trend?.direction).toBe('sideways');
  });

  it('says where in the window price sits', () => {
    expect(buildTechnicalRead(rising)?.rangePositionPct).toBeGreaterThan(95);
    expect(buildTechnicalRead(series(Array.from({ length: 60 }, (_, i) => 200 - i)))?.rangePositionPct).toBeLessThan(5);
  });

  it('exposes the floor it needs, so callers do not re-guess it', () => {
    expect(MIN_BARS_FOR_READ).toBeGreaterThan(14);
  });
});

describe('describeTechnicalRead', () => {
  it('describes measurements and never recommends an action', () => {
    const lines = describeTechnicalRead(buildTechnicalRead(rising) as NonNullable<ReturnType<typeof buildTechnicalRead>>);
    const text = lines.join(' ').toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    // The whole point: this codebase does not tell anybody to trade, and a
    // technical panel is exactly where that would creep in.
    for (const word of ['nên mua', 'nên bán', 'chốt lời', 'cắt lỗ', 'khuyến nghị', 'sẽ tăng', 'sẽ giảm']) {
      expect(text, `must not contain "${word}"`).not.toContain(word);
    }
  });

  it('says nothing about a reading it does not have', () => {
    const read = buildTechnicalRead(series([100, 101, 102]));
    const text = describeTechnicalRead(read as NonNullable<typeof read>).join(' ');
    expect(text).not.toContain('RSI');
    expect(text).not.toContain('EMA');
  });

  it('flags an RSI past the conventional thresholds as a fact about the number', () => {
    const overbought = describeTechnicalRead(buildTechnicalRead(rising) as NonNullable<ReturnType<typeof buildTechnicalRead>>);
    expect(overbought.join(' ')).toContain('trên ngưỡng 70');
  });
});
