import type { TradeSummary } from '@/lib/types';
import { cx, formatUsd } from '@/lib/format';

interface JournalSummaryProps {
  summary: TradeSummary;
}

/** Same stat-tile shape as PerformanceCard's Stat — same rule applies: no closed trades means no rate to show, not a misleading 0%. */
export function JournalSummary({ summary }: JournalSummaryProps) {
  const { closedCount, winRatePct, totalPnlUsd, avgPnlPct, openCount } = summary;
  const openPnl = summary.unrealizedPnlUsd;
  const priced = summary.unrealizedPricedCount ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat
        label="Win rate"
        value={winRatePct === null ? '—' : `${winRatePct.toFixed(0)}%`}
        tone={winRatePct === null ? undefined : winRatePct >= 50 ? 'emerald' : 'rose'}
        detail={`${closedCount} closed`}
      />
      <Stat
        label="Total P&L"
        value={totalPnlUsd === null ? '—' : formatUsd(totalPnlUsd, false)}
        detail={totalPnlUsd === null && closedCount > 0 ? 'no sizes logged' : undefined}
        tone={totalPnlUsd === null ? undefined : totalPnlUsd >= 0 ? 'emerald' : 'rose'}
      />
      <Stat
        label="Avg P&L / trade"
        value={avgPnlPct === null ? '—' : `${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(2)}%`}
        tone={avgPnlPct === null ? undefined : avgPnlPct >= 0 ? 'emerald' : 'rose'}
      />
      <Stat label="Open positions" value={String(openCount)} />
      {openCount > 0 && (
        <Stat
          label="P&L đang mở"
          // Deliberately its own tile, never folded into Total P&L: that
          // one is realized and settled, this one moves on its own every
          // time the page polls.
          value={openPnl === null || openPnl === undefined ? '—' : formatUsd(openPnl, false)}
          detail={
            openPnl === null || openPnl === undefined
              ? 'tạm tính — chưa có giá'
              : priced < openCount
                ? `tạm tính · ${priced}/${openCount} vị thế có giá`
                : 'tạm tính'
          }
          tone={openPnl === null || openPnl === undefined ? undefined : openPnl >= 0 ? 'emerald' : 'rose'}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'emerald' | 'rose';
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-3">
      <p
        className={cx(
          'text-xl font-bold tabular-nums',
          tone === 'emerald' ? 'text-emerald-400' : tone === 'rose' ? 'text-rose-400' : 'text-slate-200',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-500">
        {label}
        {detail ? ` · ${detail}` : ''}
      </p>
    </div>
  );
}
