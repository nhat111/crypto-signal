import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import type { PerformanceBaseline, PerformanceResult } from '@/lib/types';
import { cx, formatPct } from '@/lib/format';
import { compareToBaseline, samplesNeeded } from '@/lib/edge';

const MIN_SAMPLES = 30;

interface PerformanceCardProps {
  result: PerformanceResult;
  baseline: PerformanceBaseline;
}

/**
 * Spec §24/§12: never claim a signal type has edge without real backtest
 * evidence. When `sufficientData` is false this renders the "not enough
 * data" state as the headline — same size/weight as the real numbers would
 * have been, not a footnote — so it can't be skimmed past.
 */
export function PerformanceCard({ result, baseline }: PerformanceCardProps) {
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
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="Positive move" value={`${positiveMovePct.toFixed(0)}%`} tone="emerald" />
            <Stat label="Negative move" value={`${negativeMovePct.toFixed(0)}%`} tone="rose" />
            <Stat label="Median move" value={formatPct(medianMovePct)} />
          </div>
          <VsBaseline result={result} baseline={baseline} />
        </>
      )}

      <p className="mt-3 text-[11px] text-slate-500">
        {sampleCount} sample{sampleCount === 1 ? '' : 's'} · {horizon} horizon
      </p>
    </div>
  );
}

/**
 * The signal against the baseline, with the sample size taken seriously.
 *
 * This used to subtract two percentages and colour the result green when
 * the difference was positive, which treats thirty outcomes and ten
 * thousand identically. A signal at 58% on 30 samples showed "+7pp" in
 * green against a 51% baseline — the interval there spans roughly 40% to
 * 76%, so the honest reading is "cannot tell yet", and green said the
 * opposite.
 *
 * `sufficientData` decides a number may be shown. It says nothing about
 * whether that number differs from doing nothing, and conflating the two
 * is how this page would have manufactured edge out of noise exactly when
 * replayed outcomes started arriving in bulk.
 */
function VsBaseline({ result, baseline }: { result: PerformanceResult; baseline: PerformanceBaseline }) {
  if (baseline.positiveMovePct === null || baseline.medianMovePct === null) return null;

  const { verdict, deltaPp, marginPp } = compareToBaseline(
    result.positiveMovePct,
    result.sampleCount,
    baseline.positiveMovePct,
    baseline.sampleCount,
  );
  const medianDelta = result.medianMovePct - baseline.medianMovePct;
  const needed = verdict === 'indistinguishable' ? samplesNeeded(result.positiveMovePct, baseline.positiveMovePct, baseline.sampleCount) : null;

  const tone =
    verdict === 'beats' ? 'text-emerald-400' : verdict === 'worse' ? 'text-rose-400' : 'text-slate-400';

  return (
    <div className="mt-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">vs baseline</p>
      <p className={cx('mt-0.5 text-xs font-semibold tabular-nums', tone)}>
        {signed(deltaPp, 0)}pp hit rate · {signed(medianDelta, 2)}% median
        {marginPp !== null && <span className="font-normal text-slate-500"> (±{marginPp.toFixed(0)}pp)</span>}
      </p>
      {verdict === 'indistinguishable' && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Chưa phân biệt được với việc không làm gì — khoảng sai số còn phủ lên baseline.
          {needed !== null && ` Cần khoảng ${needed.toLocaleString('vi-VN')} mẫu để nói chắc.`}
        </p>
      )}
      {verdict === 'worse' && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Kém hơn baseline một cách rõ rệt.</p>
      )}
    </div>
  );
}

function signed(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
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
