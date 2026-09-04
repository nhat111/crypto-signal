import Link from 'next/link';
import { SeverityBadge } from '@/components/SeverityBadge';
import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import { SEVERITY_COLORS } from '@/lib/severity';
import { SIGNAL_MEANING, evidenceReasons } from '@/lib/signalMeaning';
import type { Signal } from '@/lib/types';
import { cx, formatDateTime } from '@/lib/format';

interface SignalRowProps {
  signal: Signal;
  /** Show the symbol chip — hidden on the symbol-detail page where it's redundant. */
  showSymbol?: boolean;
  /**
   * Whether the recorded outcomes say this type does worse than doing
   * nothing. A chip, not a paragraph: the numbers and the link are in the
   * banner above the list, once, instead of on every row.
   */
  flagged?: boolean;
}

/**
 * One signal: what it means, then the evidence for it.
 *
 * The evidence stays visible inline, never behind a click — that is the
 * product's explainability, per the task's product intent. But it used to
 * be the *only* thing on the card, and it opens with lines like "Spot CVD
 * skew 0.178", which is precise and says nothing at all to the person
 * this dashboard was built for. Precision that cannot be read is not
 * explanation; it only proves the engine was not guessing.
 *
 * So the plain sentence leads and the numbers support it. The order is
 * the whole fix: a reader who stops after one line now stops having
 * understood something.
 */
export function SignalRow({ signal, showSymbol = true, flagged = false }: SignalRowProps) {
  const colors = SEVERITY_COLORS[signal.severity];

  return (
    <li
      className={cx('rounded-lg border-l-4 bg-slate-900/60 px-3 py-2.5', colors.leftBorder)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={signal.severity} />
        <SignalTypeBadge signalType={signal.signalType} />
        {flagged && (
          <span
            title="Loại này đang kém hơn mức nền — xem chi tiết ở đầu danh sách"
            className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
          >
            kém hơn mức nền
          </span>
        )}
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
          độ tin cậy {Math.round(signal.confidence)}%
        </span>
        <span className="ml-auto text-[11px] text-slate-500">{formatDateTime(signal.timestamp)}</span>
      </div>

      <Meaning signalType={signal.signalType} />
      <Evidence reasons={signal.reasons} />
    </li>
  );
}

/** The one sentence somebody could repeat to a friend, and the one thing it does not say. */
function Meaning({ signalType }: { signalType: Signal['signalType'] }) {
  const meaning = SIGNAL_MEANING[signalType];
  if (!meaning) return null;

  return (
    <div className="mt-2 rounded border border-slate-800 bg-slate-950/40 px-2.5 py-2">
      <p className="text-[13px] leading-relaxed text-slate-200">{meaning.plain}</p>
      {/* The caveat is not decoration. Every one of these patterns gets read
          as a buy or sell instruction, and none of them is one — so what
          the signal does not say travels with it, at the same size as
          what it does. */}
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{meaning.caveat}</p>
    </div>
  );
}

/**
 * The numbers that made the rule fire.
 *
 * Subordinate to the sentence above rather than hidden below it: someone
 * checking whether the engine is honest must be able to see exactly what
 * it measured, without a click. Someone who just wants to know what
 * happened should not have to read it first.
 */
function Evidence({ reasons }: { reasons: string[] }) {
  const lines = evidenceReasons(reasons);
  if (lines.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Căn cứ</p>
      <ul className="mt-1 space-y-0.5 pl-1 text-[11px] leading-relaxed text-slate-500">
        {lines.map((reason, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-slate-700">–</span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
