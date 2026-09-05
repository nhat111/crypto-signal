'use client';

import type { Timeframe } from '@/lib/types';
import { cx } from '@/lib/format';

/**
 * Which frame the cards read.
 *
 * It used to be a constant in the page, set to 5m, and it kept being the
 * wrong one: a 5m health score flips several times inside one decision,
 * and it silently disagreed with whatever the Telegram bot was set to.
 * A hardcoded frame is always somebody's wrong frame — so the reader picks.
 */
export function TimeframePicker({
  available,
  value,
  onChange,
}: {
  available: Timeframe[];
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}) {
  if (available.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-slate-500">Khung</span>
      {available.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          aria-pressed={tf === value}
          className={cx(
            'rounded border px-2 py-0.5 text-xs font-semibold transition-colors',
            tf === value
              ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
              : 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300',
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
