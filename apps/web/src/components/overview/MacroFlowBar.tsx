import type { FlowFetchState, StablecoinFlow, StablecoinFlowWindow } from '@/lib/types';
import { cx, formatUsd } from '@/lib/format';

interface MacroFlowBarProps {
  /** Null until the worker's first refresh lands — or forever, if it is broken. `fetch` says which. */
  flow: StablecoinFlow | null;
  fetch: FlowFetchState | null;
}

/**
 * A refresh that has never once succeeded is broken, not early. One or two
 * failures after a good run is an upstream hiccup and not worth shouting
 * about; a run of them means nobody is going to notice on their own.
 */
const FAILURE_STREAK_WORTH_SHOWING = 3;

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
export function MacroFlowBar({ flow, fetch }: MacroFlowBarProps) {
  const neverSucceeded = fetch !== null && fetch.lastSuccessAt === null && fetch.consecutiveFailures > 0;
  const refreshFailing = fetch !== null && fetch.consecutiveFailures >= FAILURE_STREAK_WORTH_SHOWING;

  if (!flow) {
    // The two reasons this can be empty look identical in the data and are
    // not remotely the same problem, so they do not get the same message.
    if (neverSucceeded) {
      return (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.07] px-4 py-2.5 text-xs">
          <span className="font-semibold text-rose-300">Stablecoin supply: broken.</span>{' '}
          <span className="text-slate-400">
            {fetch.consecutiveFailures} failed {fetch.consecutiveFailures === 1 ? 'attempt' : 'attempts'}, none
            has ever succeeded. This is not a slow start — the upstream fetch needs fixing.
          </span>
          {fetch.lastError && (
            <span className="mt-1 block font-mono text-[11px] text-rose-300/70">{fetch.lastError}</span>
          )}
        </div>
      );
    }

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

      {refreshFailing && (
        // Data present but going stale: the reading looks live and is not.
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300">
          refresh failing ×{fetch.consecutiveFailures}
        </span>
      )}

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
