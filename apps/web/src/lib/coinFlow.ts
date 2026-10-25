import type { CoinEdgeComparison, CoinFlow, CoinScanRow } from './types';

export type FlowTone = 'good' | 'mixed' | 'warn' | 'bad' | 'neutral';

/**
 * What each seven-day flow label means, in the words the Telegram bot uses
 * too. `tone` colours the badge; it says how much of the move real spot
 * money explains, not whether to buy.
 */
export const FLOW_META: Record<CoinFlow, { label: string; tone: FlowTone; meaning: string }> = {
  spot_led: { label: 'Spot mua dẫn', tone: 'good', meaning: 'Giá tăng, bên mua chủ động trên spot nhiều hơn bên bán, đòn bẩy không tăng mạnh.' },
  spot_and_leverage: { label: 'Spot + đòn bẩy', tone: 'mixed', meaning: 'Giá tăng, spot mua ròng nhưng OI hoặc funding cũng đang nóng lên.' },
  leverage_led: { label: 'Đòn bẩy kéo', tone: 'warn', meaning: 'Giá tăng nhờ OI tăng hoặc long trả funding cao, spot không mua ròng rõ.' },
  short_squeeze: { label: 'Short bị ép', tone: 'warn', meaning: 'Giá tăng, OI tăng mà funding âm: vị thế mới chủ yếu là short chặn đà tăng. Short đóng lệnh có thể đẩy giá thêm, nhưng khi hết short thì đà tăng thường hụt. Replay 2024–2026: giữ nhãn này từ 2 ngày trở lên thì 14 ngày sau coin kém coin trung bình khoảng 2,6%.' },
  short_covering: { label: 'Short đóng lệnh', tone: 'warn', meaning: 'Giá tăng trong khi OI giảm: phần lớn là short mua lại để đóng vị thế.' },
  up_unconfirmed: { label: 'Tăng, chưa xác nhận', tone: 'neutral', meaning: 'Giá tăng nhưng không thấy spot mua ròng hay đòn bẩy tăng rõ.' },
  spot_selling: { label: 'Spot bán ròng', tone: 'bad', meaning: 'Giá giảm, bên bán chủ động trên spot nhiều hơn bên mua.' },
  shorts_building: { label: 'Short mở thêm', tone: 'bad', meaning: 'Giá giảm trong khi OI tăng: vị thế mới được mở, nhiều khả năng là short.' },
  long_unwind: { label: 'Long xả đòn bẩy', tone: 'warn', meaning: 'Giá giảm cùng OI giảm: long đóng lệnh hoặc bị thanh lý.' },
  down_unconfirmed: { label: 'Giảm, chưa rõ phe', tone: 'neutral', meaning: 'Giá giảm nhưng không thấy spot bán ròng hay OI thay đổi rõ.' },
  accumulation: { label: 'Đi ngang, spot gom', tone: 'good', meaning: 'Giá gần như đứng yên trong khi spot mua ròng: có người hấp thụ lượng bán.' },
  distribution: { label: 'Đi ngang, spot xả', tone: 'bad', meaning: 'Giá gần như đứng yên trong khi spot bán ròng.' },
  leverage_building: { label: 'Đòn bẩy tích tụ', tone: 'warn', meaning: 'Giá đứng yên nhưng OI tăng mạnh: vị thế dồn lại, dễ có biến động lớn.' },
  quiet: { label: 'Yên ắng', tone: 'neutral', meaning: 'Không có chuyển động đáng kể ở giá, spot hay đòn bẩy.' },
};

export type CoinSort = 'rs30' | 'rs7' | 'volume';

/** Strength against BTC for sorting: 30 days where it exists, else 7, else last. BTC itself sorts by its zero like any other row. */
function strength(row: CoinScanRow, key: 'rs30d' | 'rs7d'): number {
  const v = row[key] ?? (key === 'rs30d' ? row.rs7d : null);
  return v ?? Number.NEGATIVE_INFINITY;
}

export function sortCoins(rows: CoinScanRow[], sort: CoinSort): CoinScanRow[] {
  const copy = [...rows];
  if (sort === 'volume') return copy.sort((a, b) => a.volumeRank - b.volumeRank);
  const key = sort === 'rs30' ? 'rs30d' : 'rs7d';
  return copy.sort((a, b) => strength(b, key) - strength(a, key) || a.volumeRank - b.volumeRank);
}

/** One comparison's verdict, in words, with the reason when there is none yet. */
export function edgeVerdictText(c: CoinEdgeComparison, minSamples: number): { text: string; tone: FlowTone } {
  if (c.verdict === null) {
    const have = Math.min(c.group.samples, c.baseline.samples);
    return { text: `Chưa đủ dữ liệu (${have}/${minSamples} mẫu)`, tone: 'neutral' };
  }
  if (c.verdict === 'beats') return { text: 'Có lợi thế thật', tone: 'good' };
  if (c.verdict === 'worse') return { text: 'Tệ hơn mức nền', tone: 'bad' };
  return { text: 'Chưa phân biệt được với mức nền', tone: 'neutral' };
}

/** "2026-10-14" → "14/10": the scan day as the column header says it. */
export function shortDay(day: string | null | undefined): string | null {
  const m = day ? /^\d{4}-(\d{2})-(\d{2})$/.exec(day) : null;
  return m ? `${m[2]}/${m[1]}` : null;
}

/** Percent move from the scan's daily close to the live price; null when either is missing. */
export function changeSinceClose(close: number | null | undefined, live: number | null | undefined): number | null {
  if (close === null || close === undefined || live === null || live === undefined || !(close > 0) || !Number.isFinite(live)) return null;
  return ((live - close) / close) * 100;
}
