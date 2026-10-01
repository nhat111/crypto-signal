import type { TrendState } from '@/lib/types';
import { cx } from '@/lib/format';

const LABEL: Record<TrendState['trend'], string> = { up: 'Tăng', down: 'Giảm', sideways: 'Đi ngang' };
const TONE: Record<TrendState['trend'], string> = {
  up: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  down: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  sideways: 'border-slate-600 bg-slate-800/60 text-slate-300',
};

/** A label that changed within this window is called out as new. */
const RECENT_MS = 36 * 60 * 60_000;

/**
 * The daily structure read, on the Overview card.
 *
 * Read from the last CLOSED daily bar, so it does not move intraday — the
 * reasons are in the tooltip rather than on the card, because the card is
 * glanced at and the reasons are read.
 */
export function TrendBadge({ trend, nowMs }: { trend: TrendState; nowMs: number | null }) {
  const recent = trend.changedAt !== null && nowMs !== null && nowMs - trend.changedAt < RECENT_MS;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" title={trend.reasons.join('\n')}>
      <span className="uppercase tracking-wide text-slate-500">Xu hướng 1D</span>
      <span className={cx('rounded border px-1.5 py-0.5 font-semibold', TONE[trend.trend])}>{LABEL[trend.trend]}</span>
      {trend.aboveEma !== null && (
        <span className="text-slate-500">
          {trend.aboveEma ? 'trên' : 'dưới'} EMA{trend.emaPeriod}
        </span>
      )}
      {trend.event === 'up_broken' && <span className="font-semibold text-amber-300">gãy cấu trúc tăng</span>}
      {trend.event === 'down_broken' && <span className="font-semibold text-sky-300">gãy cấu trúc giảm</span>}
      {recent && trend.previousTrend && (
        <span className="text-amber-300">vừa đổi từ {LABEL[trend.previousTrend].toLowerCase()}</span>
      )}
    </div>
  );
}
