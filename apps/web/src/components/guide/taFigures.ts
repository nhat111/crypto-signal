import type { Candle, Level, Marker, Zone } from './CandleChart';
import { atr, ema, rsi } from '@/lib/taMath';

/**
 * Candle data for the TA guide's figures.
 *
 * Hand-built, not sampled from a market: each series is the shortest one
 * that shows its single idea, and the prices match the numbers in the
 * table beside it exactly. Where a figure illustrates a trade, it ends on
 * the candle where the decision is made — never on the candle that proves
 * the decision right.
 */

const c = (o: number, h: number, l: number, close: number): Candle => ({ o, h, l, c: close });

/* --- Cấu trúc thị trường: đỉnh sau cao hơn, đáy sau cao hơn --------- */

export const STRUCTURE: {
  candles: Candle[];
  domain: [number, number];
  markers: Marker[];
} = {
  candles: [
    c(92, 96, 91, 95),
    c(95, 100, 94, 99),
    c(99, 105, 98, 103),
    c(103, 104, 99, 101),
    c(101, 102, 95.5, 97),
    c(97, 102, 96.5, 101),
    c(101, 107, 100, 106),
    c(106, 112, 105, 110),
    c(110, 111, 106, 107),
    c(107, 108, 102.5, 104),
    c(104, 109, 103.5, 108),
    c(108, 114, 107, 113),
    c(113, 120, 112, 118),
    c(118, 124, 117, 122),
    c(122, 123, 119, 120),
    c(120, 125, 119.5, 123),
  ],
  domain: [89, 128],
  markers: [
    { index: 4, label: 'Đáy 1', place: 'below' },
    { index: 7, label: 'Đỉnh 1', place: 'above' },
    { index: 9, label: 'Đáy 2', place: 'below' },
    { index: 13, label: 'Đỉnh 2', place: 'above' },
  ],
};

/* --- Kháng cự bị phá thì thành hỗ trợ ------------------------------- */

export const FLIP: {
  candles: Candle[];
  domain: [number, number];
  zones: Zone[];
  markers: Marker[];
} = {
  candles: [
    c(50, 54, 49, 53),
    c(53, 58, 52, 57),
    c(57, 62, 56, 60),
    c(60, 61, 55, 56),
    c(56, 57, 51, 52),
    c(52, 56, 51, 55),
    c(55, 61.5, 54, 59),
    c(59, 60, 54, 55),
    c(55, 59, 54, 58),
    c(58, 64, 57.5, 63),
    c(63, 66, 62.5, 65),
    c(65, 65.5, 60.5, 62),
    c(62, 65, 60.2, 64),
    c(64, 69, 63.5, 68),
  ],
  domain: [48, 71],
  zones: [{ from: 60, to: 62, label: 'Vùng 60–62', tone: 'resistance' }],
  markers: [
    { index: 2, label: 'Bị chặn', place: 'above' },
    { index: 9, label: 'Phá lên', place: 'above' },
    { index: 12, label: 'Test lại', place: 'below' },
  ],
};

/* --- Ví dụ 1: mua khi giá hồi trong xu hướng tăng ------------------- */

export const PULLBACK: {
  candles: Candle[];
  domain: [number, number];
  zones: Zone[];
  levels: Level[];
  markers: Marker[];
} = {
  candles: [
    c(104, 109, 103, 108),
    c(108, 113, 107, 112),
    c(112, 116.5, 111, 115),
    c(115, 116, 110, 111),
    c(111, 112, 106, 107),
    c(107, 108, 103, 104),
    c(104, 105, 100.5, 101),
    c(101, 103, 98.8, 102),
  ],
  domain: [96, 122],
  zones: [
    { from: 98, to: 100, label: 'Hỗ trợ 98–100', tone: 'support' },
    { from: 118, to: 120, label: 'Kháng cự 118–120', tone: 'resistance' },
  ],
  levels: [
    { price: 118, label: 'Chốt 118', tone: 'target' },
    { price: 103, label: 'Vào 103', tone: 'entry' },
    { price: 97.5, label: 'Cắt 97,5', tone: 'stop' },
  ],
  markers: [{ index: 7, label: 'Râu dưới', place: 'below' }],
};

/* --- Ví dụ 1 sai: cắt lỗ nằm trong vùng hỗ trợ ---------------------- */

export const STOP_INSIDE: {
  candles: Candle[];
  domain: [number, number];
  zones: Zone[];
  levels: Level[];
  markers: Marker[];
} = {
  candles: [
    c(104, 105, 100.5, 101),
    c(101, 103, 98.8, 102),
    c(102, 103.5, 98.2, 99.5),
    c(99.5, 101, 98.1, 100.5),
    c(100.5, 104, 100, 103.5),
    c(103.5, 108, 103, 107),
  ],
  domain: [96.5, 109.5],
  zones: [{ from: 98, to: 100, label: 'Hỗ trợ 98–100', tone: 'support' }],
  levels: [
    { price: 99, label: 'Cắt 99 ✗', tone: 'stop' },
    { price: 97.5, label: 'Cắt 97,5 ✓', tone: 'target' },
  ],
  markers: [{ index: 2, label: 'Bị quét', place: 'below' }],
};

/* --- Ví dụ 2: phá vùng rồi test lại, kèm khối lượng ----------------- */

export const BREAKOUT: {
  candles: Candle[];
  domain: [number, number];
  zones: Zone[];
  levels: Level[];
  markers: Marker[];
  volumes: number[];
  volumeHighlight: number;
} = {
  candles: [
    c(52, 56, 51, 55),
    c(55, 61, 54, 59),
    c(59, 60, 55, 56),
    c(56, 57, 51.5, 53),
    c(53, 58, 52, 57),
    c(57, 61.5, 56, 60),
    c(60, 61, 57, 58),
    c(58, 62, 57.5, 61),
    c(61, 66, 60.5, 65),
    c(65, 65.5, 62, 63),
    c(63, 64, 60.3, 62),
    c(62, 65.5, 61.8, 64.5),
  ],
  domain: [50, 75],
  zones: [{ from: 60, to: 62, label: 'Vùng 60–62', tone: 'resistance' }],
  levels: [
    { price: 72, label: 'Chốt 72', tone: 'target' },
    { price: 63, label: 'Vào 63', tone: 'entry' },
    { price: 58.5, label: 'Cắt 58,5', tone: 'stop' },
  ],
  markers: [
    { index: 8, label: 'Phá lên', place: 'above' },
    { index: 10, label: 'Test lại', place: 'below' },
  ],
  volumes: [40, 45, 42, 38, 41, 44, 39, 46, 96, 55, 48, 52],
  volumeHighlight: 8,
};

/* --- Ví dụ 3: giá ở giữa vùng, không có gì để làm ------------------- */

export const NO_TRADE: {
  candles: Candle[];
  domain: [number, number];
  zones: Zone[];
  markers: Marker[];
} = {
  candles: [
    c(105, 108.2, 103, 106),
    c(106, 107.9, 101.5, 104),
    c(104, 108, 102, 106.5),
    c(106.5, 108.4, 103.5, 105),
    c(105, 107.5, 101, 106),
    c(106, 108.3, 102.5, 105.5),
    c(105.5, 108, 102, 104.5),
    c(104.5, 107.8, 103, 106),
    c(106, 108.1, 101.8, 105),
    c(105, 108, 103.2, 105.5),
    c(105.5, 107.5, 102.4, 104.8),
    c(104.8, 108.2, 102.8, 105.5),
  ],
  domain: [98, 113],
  zones: [
    { from: 99, to: 101, label: 'Hỗ trợ ~100', tone: 'support' },
    { from: 109, to: 111, label: 'Kháng cự ~110', tone: 'resistance' },
  ],
  markers: [{ index: 5, label: 'Giá ở giữa', place: 'above' }],
};

/* ------------------------------------------------------------------ */
/* Indicator figures                                                   */
/* ------------------------------------------------------------------ */

/**
 * Every line below is computed from the candles beside it by the same
 * functions in `lib/taMath.ts`, never drawn by eye. A moving average that
 * does not actually track its own candles would teach a relationship that
 * is not there.
 */

/** Plausible candles from a close series: each opens at the previous close, with an even wick. */
function seriesFromCloses(closes: number[], wick = 0.7): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : (closes[i - 1] as number);
    return c(open, Math.max(open, close) + wick, Math.min(open, close) - wick, close);
  });
}

/** Price domain padded off the extremes, so no wick is ever clipped by a hand-picked range. */
function domainOf(candles: Candle[], padFraction = 0.08): [number, number] {
  const lo = Math.min(...candles.map((x) => x.l));
  const hi = Math.max(...candles.map((x) => x.h));
  const pad = (hi - lo) * padFraction;
  return [lo - pad, hi + pad];
}

const closeOf = (candles: Candle[]): number[] => candles.map((x) => x.c);

/* --- EMA: what it is, and why a longer one is slower ---------------- */

const EMA_BASICS_CANDLES = seriesFromCloses([
  100, 101.5, 103, 102, 104, 106, 105, 107.5, 109, 108, 110, 112, 111, 113.5, 115,
  114, 112, 109.5, 107, 105, 106.5, 108, 110, 112.5, 115, 117, 116, 118.5, 121, 123,
]);

export const EMA_BASICS = {
  candles: EMA_BASICS_CANDLES,
  domain: domainOf(EMA_BASICS_CANDLES),
  overlays: [
    { values: ema(closeOf(EMA_BASICS_CANDLES), 5), label: 'EMA 5', tone: 'fast' as const },
    { values: ema(closeOf(EMA_BASICS_CANDLES), 15), label: 'EMA 15', tone: 'slow' as const },
  ],
  markers: [{ index: 19, label: 'EMA 5 quay đầu trước', place: 'below' as const }],
};

/* --- EMA as a regime filter ---------------------------------------- */

const EMA_FILTER_CANDLES = seriesFromCloses([
  100, 102, 101.5, 104, 106, 105, 108, 110, 109, 112, 114, 113, 116, 118, 117.5,
  120, 122, 121, 124, 126, 125, 127, 129, 128, 130, 129, 127, 124, 121, 118, 116, 114, 112.5, 111,
]);

export const EMA_FILTER = {
  candles: EMA_FILTER_CANDLES,
  domain: domainOf(EMA_FILTER_CANDLES),
  overlays: [{ values: ema(closeOf(EMA_FILTER_CANDLES), 10), label: 'EMA 10', tone: 'slow' as const }],
  markers: [
    { index: 18, label: 'Trên EMA — tìm mua', place: 'above' as const },
    { index: 29, label: 'Dưới EMA — đứng ngoài', place: 'below' as const },
  ],
};

/* --- RSI ------------------------------------------------------------ */

const RSI_CANDLES = seriesFromCloses([
  100, 101, 100.5, 102, 103, 102.5, 104, 105.5, 105, 107, 108.5, 108, 110, 112, 111.5,
  114, 116, 115.5, 118, 120, 122, 121, 124, 126, 125.5, 128, 130,
  126.5, 123, 120, 117.5, 115, 113, 112, 113.5, 116, 119,
]);

export const RSI_FIG = {
  candles: RSI_CANDLES,
  domain: domainOf(RSI_CANDLES),
  markers: [
    { index: 20, label: 'Giá vẫn tăng', place: 'above' as const },
    { index: 32, label: 'Hồi rồi bật', place: 'below' as const },
  ],
  pane: {
    title: 'RSI (14)',
    values: rsi(closeOf(RSI_CANDLES), 14),
    domain: [20, 100] as [number, number],
    bands: [{ from: 40, to: 50, label: '40–50' }],
    lines: [{ at: 70, label: '70' }],
  },
};

/* --- ATR ------------------------------------------------------------ */

const ATR_CANDLES: Candle[] = [
  ...Array.from({ length: 14 }, (_, i) => {
    const base = 100 + i * 0.2;
    return c(base, base + 0.6, base - 0.6, base + 0.2);
  }),
  // Alternating direction on purpose: ATR measures how far price travels,
  // not which way. A volatile half drawn as twelve red candles would teach
  // "volatile means falling", which is a different and wrong lesson.
  ...Array.from({ length: 12 }, (_, i) => {
    const base = 102.6 + (i % 2 === 0 ? 0.4 : -0.4);
    const up = i % 2 === 0;
    return c(base, base + 3.4, base - 4.2, up ? base + 2.2 : base - 2.6);
  }),
];

export const ATR_FIG = {
  candles: ATR_CANDLES,
  domain: domainOf(ATR_CANDLES),
  levels: [{ price: 98.6, label: 'Cắt lỗ', tone: 'stop' as const }],
  markers: [
    { index: 6, label: 'Nến nhỏ', place: 'above' as const },
    { index: 20, label: 'Nến to gấp mấy lần', place: 'above' as const },
  ],
  pane: {
    title: 'ATR (7) — biên độ rung trung bình',
    values: atr(
      ATR_CANDLES.map((x) => ({ high: x.h, low: x.l, close: x.c })),
      7,
    ),
    domain: [0, 8] as [number, number],
  },
};
