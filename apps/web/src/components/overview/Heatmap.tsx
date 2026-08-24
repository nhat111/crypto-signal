import Link from 'next/link';
import { HEALTH_COLORS, HEALTH_NA_COLORS } from '@/lib/health';
import type { OverviewRow, Timeframe } from '@/lib/types';
import { cx, formatScore } from '@/lib/format';

interface HeatmapProps {
  symbols: string[];
  timeframes: Timeframe[];
  rows: OverviewRow[];
}

/**
 * Symbol × timeframe health-score grid (spec §19). Backed entirely by
 * /api/overview's `rows` — grouped by timeframe for the columns, per
 * API_CONTRACT.md. Color is UI-only; the cell's number is the real value.
 */
export function Heatmap({ symbols, timeframes, rows }: HeatmapProps) {
  const cellFor = (symbol: string, timeframe: Timeframe): OverviewRow | undefined =>
    rows.find((r) => r.symbol === symbol && r.timeframe === timeframe);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-slate-800 bg-slate-900/60 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
              Symbol
            </th>
            {timeframes.map((tf) => (
              <th
                key={tf}
                className="border-b border-slate-800 bg-slate-900/60 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-400"
              >
                {tf}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((symbol) => (
            <tr key={symbol} className="border-b border-slate-800/60 last:border-0">
              <td className="px-3 py-2">
                <Link
                  href={`/symbol/${symbol}`}
                  className="text-sm font-semibold text-slate-200 hover:text-sky-300"
                >
                  {symbol}
                </Link>
              </td>
              {timeframes.map((tf) => {
                const cell = cellFor(symbol, tf);
                if (!cell) {
                  return (
                    <td key={tf} className="px-3 py-2 text-center">
                      <span className="inline-flex h-9 w-14 items-center justify-center rounded-md border border-dashed border-slate-800 text-xs text-slate-600">
                        —
                      </span>
                    </td>
                  );
                }
                const colors = cell.healthStatus ? HEALTH_COLORS[cell.healthStatus] : HEALTH_NA_COLORS;
                return (
                  <td key={tf} className="px-3 py-2 text-center">
                    <Link
                      href={`/symbol/${symbol}?timeframe=${tf}`}
                      className={cx(
                        'inline-flex h-9 w-14 items-center justify-center rounded-md border text-sm font-bold tabular-nums transition-transform hover:scale-105',
                        colors.bg,
                        colors.border,
                        colors.text,
                      )}
                      title={cell.healthStatus ? `${symbol} ${tf}: ${cell.healthStatus.replace('_', ' ')}` : `${symbol} ${tf}: no Health Score (futures-only)`}
                    >
                      {cell.healthScore === null ? 'N/A' : formatScore(cell.healthScore)}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
