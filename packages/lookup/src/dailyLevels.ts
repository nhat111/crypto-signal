import { readMarketStructure, type OhlcvBar, type StructureTrend } from '@crypto-signal/indicators';

/**
 * The two 1D levels the 4H setup detector watches, read the way the
 * worker reads them (closed daily bars, pivots three bars wide, EMA200),
 * so "what would make the app call a setup here" has the same answer on
 * a lookup as in the alert.
 *
 * A lookup's own "nearest low/high" is from the chart being looked at
 * (4H by default) and is not what the setups use; showing only that sent
 * a reader to watch the wrong price.
 */
export interface DailyLevels {
  trend: StructureTrend;
  aboveEma: boolean | null;
  emaPeriod: number;
  /** The latest confirmed 1D swing low, with how far price is from it. */
  swingLow: { price: number; distancePct: number } | null;
  swingHigh: { price: number; distancePct: number } | null;
  /** What each setup needs from here, in Vietnamese. */
  watch: string[];
}

/** Matches the worker (coinSetups.ts): enough for EMA200 with room to settle. */
export const DAILY_LEVEL_BARS = 400;

const DAY_MS = 86_400_000;

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toPrecision(4);
}

export function readDailyLevels(bars: OhlcvBar[], lastPrice: number, now: number): DailyLevels | null {
  // The worker reads closed days only; today's bar would move the pivots.
  const closed = bars.filter((b) => b.openTime + DAY_MS <= now);
  const structure = readMarketStructure(closed);
  if (!structure) return null;

  const level = (price: number | undefined) =>
    price === undefined ? null : { price, distancePct: ((price - lastPrice) / lastPrice) * 100 };
  const low = structure.swingLows[structure.swingLows.length - 1]?.price;
  const high = structure.swingHighs[structure.swingHighs.length - 1]?.price;

  const watch: string[] = [];
  if (structure.aboveEma !== true) {
    watch.push(`1D đang dưới EMA${structure.emaPeriod}: bộ setup không tìm điểm vào cho coin này cho tới khi giá lên lại trên đường này.`);
  } else {
    if (structure.trend === 'up' && low !== undefined) {
      watch.push(`Hồi về đáy: chờ nến 4H chạm vùng quanh ${fmt(low)} (đáy 1D) rồi bị đẩy lên, râu dưới dài, đóng trên mức đó.`);
    } else {
      watch.push('Hồi về đáy: chỉ xét khi 1D đang tăng (đỉnh và đáy cao dần); hiện chưa phải.');
    }
    if (structure.trend !== 'down' && high !== undefined) {
      watch.push(
        high > lastPrice
          ? `Phá đỉnh: chờ nến 4H đóng trên ${fmt(high)} (đỉnh 1D) với khối lượng từ 1,5 lần trung bình 20 nến, rồi quay về test và đóng trên mức đó trong vòng 3 ngày.`
          : `Giá đã ở trên đỉnh 1D ${fmt(high)}: nếu vừa phá trong 3 ngày qua với khối lượng lớn, setup đến khi giá quay về test mức này và đóng trên nó.`,
      );
    } else {
      watch.push('Phá đỉnh: 1D đang giảm (đỉnh và đáy thấp dần), bộ setup không xét.');
    }
  }

  return {
    trend: structure.trend,
    aboveEma: structure.aboveEma,
    emaPeriod: structure.emaPeriod,
    swingLow: level(low),
    swingHigh: level(high),
    watch,
  };
}
