import { PERFORMANCE_SOURCES, type PerformanceSource } from '@/lib/types';
import { cx } from '@/lib/format';

interface SourceSwitcherProps {
  value: PerformanceSource;
  onChange: (source: PerformanceSource) => void;
}

const LABELS: Record<PerformanceSource, string> = {
  live: 'Observed',
  backfill: 'Replayed',
  all: 'Both',
};

const HINTS: Record<PerformanceSource, string> = {
  live: 'Only what the collector watched happen.',
  backfill: 'The engine re-run over historical data.',
  all: 'Counted together — read with the caveat above.',
};

/**
 * Provenance is a stronger distinction than a filter, so it gets its own
 * control rather than hiding in a dropdown: replayed samples are real
 * measurements of a weaker thing, and a reader who does not notice which
 * they are looking at is being misled.
 */
export function SourceSwitcher({ value, onChange }: SourceSwitcherProps) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="inline-flex rounded-md border border-slate-800 bg-slate-900/60 p-0.5">
        {PERFORMANCE_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={value === s}
            className={cx(
              'rounded px-3 py-1 text-sm font-semibold transition-colors',
              value === s ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            {LABELS[s]}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">{HINTS[value]}</p>
    </div>
  );
}
