import { TIMEFRAMES } from '@/lib/types';
import type { Timeframe } from '@/lib/types';
import { cx } from '@/lib/format';

interface TimeframeSwitcherProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}

export function TimeframeSwitcher({ value, onChange }: TimeframeSwitcherProps) {
  return (
    <div className="inline-flex rounded-md border border-slate-800 bg-slate-900/60 p-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          className={cx(
            'rounded px-3 py-1 text-sm font-semibold transition-colors',
            value === tf ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
