import type { SpotBreakout, SpotBreakoutsResponse } from './types';

/**
 * What the replay of the breakout rule found, by year (ASSUMPTIONS §27).
 * Shown next to the list because the headline average hides that all of
 * it came from the rise of late 2024; the guide for AI quotes the same.
 */
export const BREAKOUT_REPLAY_NOTE =
  'Chạy lại 41 coin từ 8/2024: lãi chỉ đến từ đợt tăng cuối 2024 (+1.53R/lệnh); 2025 −0.26R, 2026 −0.22R dù đã lọc BTC. Đang theo dõi trên giấy, chưa phải tín hiệu mua — chỉ vào spot, rủi ro 1%/lệnh nếu có vào.';

/** Percent from the price to a lower level, as a positive distance. */
export const pctBelow = (price: number, level: number): number => ((price - level) / price) * 100;

/** Verdict line for the live record: withheld under the floor, compared with the replay above it. */
export function breakoutRecordLine(data: Pick<SpotBreakoutsResponse, 'stats' | 'minClosed' | 'replay'>): string {
  const { stats, minClosed, replay } = data;
  if (stats.closed === 0) return 'chưa có lệnh nào kết thúc';
  const head = `${stats.wins}/${stats.closed} lệnh lãi · trung bình ${(stats.avgR ?? 0).toFixed(2)}R`;
  if (stats.closed < minClosed) return `${head} — cần ${minClosed} lệnh mới đáng tin`;
  return `${head} (chạy lại: ${replay.avgR.toFixed(2)}R)`;
}

export const EXIT_LABEL: Record<Exclude<SpotBreakout['status'], 'open'>, string> = {
  stop: 'chạm cắt lỗ',
  trail: 'đóng dưới đường thoát',
};
