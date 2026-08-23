import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import type { PerformanceResult } from '@/lib/types';
import { cx, formatPct } from '@/lib/format';

const MIN_SAMPLES = 30;

interface PerformanceCardProps {
  result: PerformanceResult;
}

/**
 * Spec §24/§12: never claim a signal type has edge without real backtest
 * evidence. When `sufficientData` is false this renders the "not enough
 * data" state as the headline — same size/weight as the real numbers would
 * have been, not a footnote — so it can't be skimmed past.
 */
export function PerformanceCard({ result }: PerformanceCardProps) {
  const { signalType, sampleCount, positiveMovePct, negativeMovePct, medianMovePct, sufficientData, horizon } =
    result;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <SignalTypeBadge signalType={signalType} className="text-sm" />

      {sampleCount === 0 ? (
        <HeadlineState tone="neutral" title="No signals of this type yet" detail={`0/${MIN_SAMPLES} samples`} />
      ) : !sufficientData ? (
        <HeadlineState
          tone="warning"
          title="Not enough data yet"
          detail={`${sampleCount}/${MIN_SAMPLES} samples`}
        />
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Positive move" value={`${positiveMovePct.toFixed(0)}%`} tone="emerald" />
          <Stat label="Negative move" value={`${negativeMovePct.toFixed(0)}%`} tone="rose" />
          <Stat label="Median move" value={formatPct(medianMovePct)} />
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-500">
        {sampleCount} sample{sampleCount === 1 ? '' : 's'} · {horizon} horizon
      </p>
    </div>
  );
}

function HeadlineState({
  tone,
  title,
  detail,
}: {
  tone: 'neutral' | 'warning';
  title: string;
  detail: string;
}) {
  return (
    <div
      className={cx(
        'mt-4 rounded-md border px-3 py-5 text-center',
        tone === 'warning' ? 'border-amber-500/30 bg-amber-500/10' : 'border-slate-700 bg-slate-950/40',
      )}
    >
      <p className={cx('text-base font-bold', tone === 'warning' ? 'text-amber-300' : 'text-slate-400')}>
        {title}
      </p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'rose' }) {
  return (
    <div className="rounded bg-slate-950/60 px-2 py-2">
      <p
        className={cx(
          'text-lg font-bold tabular-nums',
          tone === 'emerald' ? 'text-emerald-400' : tone === 'rose' ? 'text-rose-400' : 'text-slate-200',
        )}
      >
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
