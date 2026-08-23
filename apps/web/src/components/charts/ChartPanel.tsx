import type { ReactNode } from 'react';

interface ChartPanelProps {
  title: string;
  lastValue?: ReactNode;
  lastValueClassName?: string;
  children: ReactNode;
}

/** Card shell shared by every chart on the symbol detail page — title + current value + the chart itself. */
export function ChartPanel({ title, lastValue, lastValueClassName, children }: ChartPanelProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
        {lastValue !== undefined && (
          <span className={lastValueClassName ?? 'text-sm font-bold tabular-nums text-slate-200'}>
            {lastValue}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
