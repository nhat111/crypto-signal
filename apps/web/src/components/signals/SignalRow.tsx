import Link from 'next/link';
import { SeverityBadge } from '@/components/SeverityBadge';
import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import { SEVERITY_COLORS } from '@/lib/severity';
import type { Signal } from '@/lib/types';
import { cx, formatDateTime } from '@/lib/format';

interface SignalRowProps {
  signal: Signal;
  /** Show the symbol chip — hidden on the symbol-detail page where it's redundant. */
  showSymbol?: boolean;
}

/**
 * One signal, reasons always visible inline (never behind a click/tooltip) —
 * this is the product's explainability, per the task's product intent.
 */
export function SignalRow({ signal, showSymbol = true }: SignalRowProps) {
  const colors = SEVERITY_COLORS[signal.severity];

  return (
    <li
      className={cx('rounded-lg border-l-4 bg-slate-900/60 px-3 py-2.5', colors.leftBorder)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={signal.severity} />
        <SignalTypeBadge signalType={signal.signalType} />
        {showSymbol && (
          <Link
            href={`/symbol/${signal.symbol}`}
            className="rounded border border-slate-700 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300 hover:border-slate-500 hover:text-slate-100"
          >
            {signal.symbol}
          </Link>
        )}
        <span className="rounded border border-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          {signal.timeframe}
        </span>
        <span className="text-[11px] font-medium text-slate-400">
          confidence {Math.round(signal.confidence)}%
        </span>
        <span className="ml-auto text-[11px] text-slate-500">{formatDateTime(signal.timestamp)}</span>
      </div>

      {signal.reasons.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 pl-1 text-xs text-slate-400">
          {signal.reasons.map((reason, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-slate-600">–</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
