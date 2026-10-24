import { formatPositionSize, positionSize, type RiskProfile } from '@crypto-signal/shared';
import type { SpotBreakoutsDTO } from './apiClient.js';
import { escapeHtml } from './formatting.js';

/** Five significant digits, so a $0.01 coin keeps its stop distance readable (the bot's 2-decimal price would print 0.01 for both). */
const formatPrice = (n: number): string =>
  n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(5).replace(/\.?0+$/, '');

/** Same wording as the web panel's BREAKOUT_REPLAY_NOTE (apps/web/src/lib/breakouts.ts); change both together. */
const REPLAY_NOTE =
  'Chạy lại 41 coin từ 8/2024: lãi chỉ đến từ đợt tăng cuối 2024 (+1.53R/lệnh); 2025 −0.26R, 2026 −0.22R dù đã lọc BTC. Đang theo dõi trên giấy, chưa phải tín hiệu mua — chỉ vào spot, rủi ro 1%/lệnh nếu có vào.';

const day = (ms: number): string => new Date(ms).toISOString().slice(5, 10).split('-').reverse().join('/');

/** /breakouts — BTC's regime, open positions sized for the chat's /risk, the last exits and the live record. */
export function formatBreakouts(data: SpotBreakoutsDTO, profile: RiskProfile | null): string {
  if (!data.enabled) return 'Danh sách phá đỉnh 20 ngày đang tắt (SPOT_BREAKOUTS=off).';
  const lines = ['<b>Phá đỉnh 20 ngày (spot)</b>'];
  const { run } = data;
  if (!run) lines.push('Chưa chạy lần nào — cập nhật mỗi ngày sau khi nến ngày đóng (7–8h sáng).');
  else if (run.regimeUp) lines.push(`Xu hướng dài của BTC tăng (giá và EMA50 trên EMA200, nến ${day(Date.parse(run.day))}): có tìm ứng viên mới. Khác nhãn cấu trúc ở /trend.`);
  else lines.push(`Xu hướng dài của BTC chưa tăng (nến ${day(Date.parse(run.day))}): không vào lệnh mới — đứng ngoài là một phần của quy tắc.`);

  if (data.open.length > 0) {
    lines.push('', 'Đang mở:');
    for (const b of data.open) {
      const stopPct = ((b.entry - b.stop) / b.entry) * 100;
      lines.push(`<b>${escapeHtml(b.symbol)}</b> vào nến ${day(b.barOpenTime)}`);
      lines.push(`  Vào ${formatPrice(b.entry)} · cắt lỗ ${formatPrice(b.stop)} (−${stopPct.toFixed(1)}%) · thoát nếu nến ngày đóng dưới ${formatPrice(b.trail)}`);
      if (profile) {
        const asset = escapeHtml(b.symbol.replace(/USDT$/, ''));
        for (const line of formatPositionSize(positionSize(profile, 'long', b.entry, b.stop), profile, asset)) lines.push(`  ${line}`);
      }
    }
  } else if (run) {
    lines.push('', 'Không có vị thế nào đang mở.');
  }

  const done = data.closed.slice(0, 5);
  if (done.length > 0) {
    lines.push('', 'Gần đây:');
    for (const b of done) {
      const r = b.rMultiple ?? 0;
      lines.push(`  ${escapeHtml(b.symbol)} ${day(b.barOpenTime)}→${b.exitTime ? day(b.exitTime) : '?'} ${b.status === 'stop' ? 'cắt lỗ' : 'thoát'} ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`);
    }
  }
  const { stats } = data;
  if (stats.closed > 0) {
    lines.push(
      '',
      `Kết quả thật: ${stats.wins}/${stats.closed} lệnh lãi, trung bình ${(stats.avgR ?? 0).toFixed(2)}R` +
        (stats.closed < data.minClosed ? ` (cần ${data.minClosed} lệnh mới đáng tin).` : ` (chạy lại: ${data.replay.avgR.toFixed(2)}R).`),
    );
  }
  if (!profile && data.open.length > 0) lines.push('', '<i>/risk VỐN 1 để thấy cỡ lệnh cho tài khoản của bro.</i>');
  lines.push('', `<i>${REPLAY_NOTE}</i>`);
  return lines.join('\n');
}
