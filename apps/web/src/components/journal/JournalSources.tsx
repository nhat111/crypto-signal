import type { TradeSourceStats } from '@/lib/types';
import { cx, formatUsd } from '@/lib/format';

interface JournalSourcesProps {
  sources: TradeSourceStats[];
  minClosed: number;
}

/**
 * Which ideas actually paid, grouped by where they came from.
 *
 * Two things keep this honest. A source under `minClosed` closed trades is
 * dimmed and its win rate withheld, because five trades cannot tell a good
 * caller from a lucky one. And the unrecorded group stays in the table: how
 * the trades nobody pointed you at did is the line every named source has
 * to beat to be worth following.
 */
export function JournalSources({ sources, minClosed }: JournalSourcesProps) {
  // Nothing to compare until at least one trade names a source.
  if (!sources.some((s) => s.source !== null)) return null;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">By source</h2>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        Closed trades grouped by where the idea came from. Under {minClosed} closed trades a win rate is mostly luck, so
        it is not shown. The <span className="text-slate-400">no source</span> row is your baseline — a source is only
        worth following if it beats it.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-medium">Source</th>
              <th className="py-2 pr-3 font-medium">Closed</th>
              <th className="py-2 pr-3 font-medium">Win rate</th>
              <th className="py-2 pr-3 font-medium">Avg P&amp;L</th>
              <th className="hidden py-2 pr-3 font-medium sm:table-cell">Total $</th>
              <th className="hidden py-2 font-medium sm:table-cell">Open</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const enough = s.closedCount >= minClosed;
              return (
                <tr key={s.source ?? '(none)'} className={cx('border-b border-slate-800/60', !enough && 'opacity-60')}>
                  <td className="py-2 pr-3">
                    {s.source === null ? (
                      <span className="text-slate-500">no source</span>
                    ) : (
                      <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-xs font-semibold text-violet-300">
                        {s.source}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-slate-300">{s.closedCount}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {!enough || s.winRatePct === null ? (
                      <span className="text-[11px] text-slate-600">
                        {s.closedCount === 0 ? '—' : `need ${minClosed - s.closedCount} more`}
                      </span>
                    ) : (
                      <span className={s.winRatePct >= 50 ? 'text-emerald-400' : 'text-rose-400'}>
                        {s.winRatePct.toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {s.avgPnlPct === null ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <span className={s.avgPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {s.avgPnlPct >= 0 ? '+' : ''}
                        {s.avgPnlPct.toFixed(2)}%
                      </span>
                    )}
                  </td>
                  <td className="hidden py-2 pr-3 tabular-nums sm:table-cell">
                    {s.totalPnlUsd === null ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <span className={s.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {formatUsd(s.totalPnlUsd, false)}
                      </span>
                    )}
                  </td>
                  <td className="hidden py-2 tabular-nums text-slate-400 sm:table-cell">{s.openCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
