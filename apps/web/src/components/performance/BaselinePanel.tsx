import type { PerformanceBaseline } from '@/lib/types';
import { formatDateTime, formatPct } from '@/lib/format';

interface BaselinePanelProps {
  baseline: PerformanceBaseline;
}

/**
 * The control: what price did over the same horizon starting from an
 * arbitrary moment.
 *
 * Placed above the cards, not beside them, because it isn't one result
 * among ten — it's the number every other card has to be read against. A
 * signal hitting 55% is meaningless until you know the market rose 55% of
 * the time anyway.
 */
export function BaselinePanel({ baseline }: BaselinePanelProps) {
  if (baseline.sampleCount === 0 || baseline.positiveMovePct === null) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
        Chưa có baseline — cần có kết quả đã ghi nhận thì mới biết phải đo trên khoảng thời gian nào.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-sky-300">Baseline — không làm gì cả</h2>
        <span className="text-[11px] text-slate-500">
          {baseline.sampleCount.toLocaleString('vi-VN')} cửa sổ
          {baseline.fromMs !== null && baseline.toMs !== null
            ? ` · ${formatDateTime(baseline.fromMs)} → ${formatDateTime(baseline.toMs)}`
            : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Cell label="Tăng" value={`${baseline.positiveMovePct.toFixed(0)}%`} />
        <Cell
          label="Trung vị"
          value={baseline.medianMovePct === null ? '—' : formatPct(baseline.medianMovePct)}
        />
        <Cell
          label={`Đủ bù phí (long)`}
          value={baseline.netPositiveMovePct === null ? '—' : `${baseline.netPositiveMovePct.toFixed(0)}%`}
        />
        <Cell
          label={`Đủ bù phí (short)`}
          value={baseline.netNegativeMovePct === null ? '—' : `${baseline.netNegativeMovePct.toFixed(0)}%`}
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Đo từ mọi nến 5m trong khoảng trên, đúng cách mà kết quả tín hiệu được đo. Một loại tín hiệu chỉ nói lên
        điều gì đó nếu nó vượt được các con số này — bằng chúng nghĩa là nó không chọn lọc được gì.{' '}
        <span className="text-slate-400">
          Hai ô cuối tính theo phí khứ hồi ~{baseline.costPct.toFixed(2).replace('.', ',')}%: tỉ lệ cửa sổ mà giá
          đi đủ xa để bù chi phí vào lệnh.
        </span>
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-950/60 px-2 py-2">
      <p className="text-lg font-bold tabular-nums text-slate-200">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
