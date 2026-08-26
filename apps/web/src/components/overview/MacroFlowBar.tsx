import type { StablecoinFlow, StablecoinFlowWindow } from '@/lib/types';
import { cx, formatUsd } from '@/lib/format';

interface MacroFlowBarProps {
  /** Null until the worker's first refresh lands. */
  flow: StablecoinFlow | null;
}

/**
 * Total stablecoin supply and how fast it's growing — a proxy for money
 * entering or leaving crypto as a whole.
 *
 * Rendered as a quiet context strip, never a badge or a signal: the data is
 * daily and lagged, it says nothing about which asset the money buys, and
 * treating it as trend confirmation is exactly the mistake it invites. The
 * "as of" day is shown for the same reason — so nobody reads a two-day-old
 * figure as live.
 */
export function MacroFlowBar({ flow }: MacroFlowBarProps) {
  if (!flow) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5 text-xs text-slate-500">
        Stablecoin supply: no data yet — the collector refreshes this a few times a day.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5 text-xs">
      <span className="font-semibold uppercase tracking-wide text-slate-400">Stablecoin supply</span>

      <span className="tabular-nums text-slate-200">{formatUsd(flow.latestUsd)}</span>

      <WindowDelta label="7d" window={flow.change7d} />
      <WindowDelta label="30d" window={flow.change30d} />

      <span className="ml-auto text-slate-600">
        as of {flow.asOfDay} · daily data, lags the market · context only, not trend confirmation
      </span>
    </div>
  );
}

function WindowDelta({ label, window: w }: { label: string; window: StablecoinFlowWindow | null }) {
  if (!w) {
    return (
      <span className="text-slate-600">
        {label} <span className="tabular-nums">—</span>
      </span>
    );
  }

  const up = w.changeUsd >= 0;
  return (
    <span className="text-slate-500">
      {label}{' '}
      <span className={cx('font-semibold tabular-nums', up ? 'text-emerald-400' : 'text-rose-400')}>
        {up ? '+' : ''}
        {formatUsd(w.changeUsd)} ({up ? '+' : ''}
        {w.changePct.toFixed(2)}%)
      </span>
    </span>
  );
}
