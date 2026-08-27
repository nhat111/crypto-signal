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
        No baseline yet — it needs recorded outcomes to know which period to measure.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-sky-300">Baseline — doing nothing</h2>
        <span className="text-[11px] text-slate-500">
          {baseline.sampleCount.toLocaleString()} windows
          {baseline.fromMs !== null && baseline.toMs !== null
            ? ` · ${formatDateTime(baseline.fromMs)} → ${formatDateTime(baseline.toMs)}`
            : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded bg-slate-950/60 px-2 py-2">
          <p className="text-lg font-bold tabular-nums text-slate-200">{baseline.positiveMovePct.toFixed(0)}%</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Positive move</p>
        </div>
        <div className="rounded bg-slate-950/60 px-2 py-2">
          <p className="text-lg font-bold tabular-nums text-slate-200">
            {baseline.medianMovePct === null ? '—' : formatPct(baseline.medianMovePct)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Median move</p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Measured from every 5m candle in the window above, the same way signal outcomes are. A signal type only
        tells you something if it beats these numbers — matching them means it selected for nothing.
      </p>
    </div>
  );
}
