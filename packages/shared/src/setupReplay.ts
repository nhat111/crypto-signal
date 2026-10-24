/**
 * What the 18-month replay of the 4H setup detector found (ASSUMPTIONS §21),
 * printed wherever a setup is shown so nobody reads a card as an edge the
 * detector does not have. The web keeps its own copy (it does not depend on
 * this package); change both together.
 */
export const SETUP_REPLAY_NOTE =
  'Đã chạy lại 18 tháng trên 41 coin: bộ dò cũ trung bình −0.39R/lệnh, bản lọc mới −0.27R — chưa có lợi thế. Chỉ để theo dõi, đừng vào tiền thật theo setup.';

/**
 * When the tightened detector (one-4H-ATR touch, BTC gate) started running
 * in production: the worker boot with PR #50, 24/10/2026 11:09:50 UTC.
 * Setups stored before it came from the old detector and are never
 * re-judged (the record stays honest), so the screens say which they are.
 */
export const SETUP_FILTER_SINCE_MS = Date.UTC(2026, 9, 24, 11, 9, 50);

export const SETUP_OLD_DETECTOR_NOTE = 'Tìm bằng bộ dò cũ (trước 24/10) — bản lọc mới sẽ không báo setup này.';

export const isOldDetectorSetup = (detectedAt: number): boolean => detectedAt < SETUP_FILTER_SINCE_MS;
