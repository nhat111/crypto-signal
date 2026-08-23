import { HORIZONS, type Horizon } from '@/lib/types';
import { cx } from '@/lib/format';

interface HorizonSwitcherProps {
  value: Horizon;
  onChange: (horizon: Horizon) => void;
}

export function HorizonSwitcher({ value, onChange }: HorizonSwitcherProps) {
  return (
    <div className="inline-flex rounded-md border border-slate-800 bg-slate-900/60 p-0.5">
      {HORIZONS.map((h) => (
        <button
          key={h}
          type="button"
          onClick={() => onChange(h)}
          className={cx(
            'rounded px-3 py-1 text-sm font-semibold transition-colors',
            value === h ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {h}
        </button>
      ))}
    </div>
  );
}
