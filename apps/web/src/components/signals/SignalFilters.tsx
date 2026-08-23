import { SIGNAL_TYPE_LABEL } from '@/lib/severity';
import { SIGNAL_TYPES, TIMEFRAMES, type SignalType, type Timeframe } from '@/lib/types';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

export interface SignalFilterState {
  symbol: string;
  timeframe: string;
  signalType: string;
}

interface SignalFiltersProps {
  value: SignalFilterState;
  onChange: (value: SignalFilterState) => void;
}

const selectClass =
  'rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 focus:border-sky-500 focus:outline-none';

export function SignalFilters({ value, onChange }: SignalFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={selectClass}
        value={value.symbol}
        onChange={(e) => onChange({ ...value, symbol: e.target.value })}
      >
        <option value="">All symbols</option>
        {SYMBOLS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={value.timeframe}
        onChange={(e) => onChange({ ...value, timeframe: e.target.value })}
      >
        <option value="">All timeframes</option>
        {(TIMEFRAMES as readonly Timeframe[]).map((tf) => (
          <option key={tf} value={tf}>
            {tf}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        value={value.signalType}
        onChange={(e) => onChange({ ...value, signalType: e.target.value })}
      >
        <option value="">All signal types</option>
        {(SIGNAL_TYPES as readonly SignalType[]).map((t) => (
          <option key={t} value={t}>
            {SIGNAL_TYPE_LABEL[t]}
          </option>
        ))}
      </select>

      {(value.symbol || value.timeframe || value.signalType) && (
        <button
          type="button"
          onClick={() => onChange({ symbol: '', timeframe: '', signalType: '' })}
          className="text-xs font-medium text-slate-500 hover:text-slate-300"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
