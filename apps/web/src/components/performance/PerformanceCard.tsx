import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import type { PerformanceBaseline, PerformanceResult } from '@/lib/types';
import { cx, formatPct } from '@/lib/format';
import { compareToBaseline, samplesNeeded } from '@/lib/edge';

const MIN_SAMPLES = 30;

interface PerformanceCardProps {
  result: PerformanceResult;
  baseline: PerformanceBaseline;
  /** How many cards on this screen are making a claim at once — see `criticalZ`. */
  comparisons: number;
}

/**
 * Spec §24/§12: never claim a signal type has edge without real backtest
 * evidence. When `sufficientData` is false this renders the "not enough
 * data" state as the headline — same size/weight as the real numbers would
 * have been, not a footnote — so it can't be skimmed past.
 */
export function PerformanceCard({ result, baseline, comparisons }: PerformanceCardProps) {
  const { signalType, sampleCount, positiveMovePct, negativeMovePct, medianMovePct, sufficientData, horizon } =
    result;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <SignalTypeBadge signalType={signalType} className="text-sm" />

      {sampleCount === 0 ? (
        <HeadlineState tone="neutral" title="Chưa có tín hiệu loại này" detail={`0/${MIN_SAMPLES} mẫu`} />
      ) : !sufficientData ? (
        <HeadlineState tone="warning" title="Chưa đủ dữ liệu" detail={`${sampleCount}/${MIN_SAMPLES} mẫu`} />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="Tăng" value={`${positiveMovePct.toFixed(0)}%`} tone="emerald" />
            <Stat label="Giảm" value={`${negativeMovePct.toFixed(0)}%`} tone="rose" />
            <Stat label="Trung vị" value={formatPct(medianMovePct)} />
          </div>
          <VsBaseline result={result} baseline={baseline} comparisons={comparisons} />
          <AfterCost result={result} baseline={baseline} />
        </>
      )}

      <p className="mt-3 text-[11px] text-slate-500">
        {sampleCount.toLocaleString('vi-VN')} mẫu · khung {horizon}
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
function VsBaseline({
  result,
  baseline,
  comparisons,
}: {
  result: PerformanceResult;
  baseline: PerformanceBaseline;
  comparisons: number;
}) {
  if (baseline.positiveMovePct === null || baseline.medianMovePct === null) return null;

  const { verdict, deltaPp, marginPp } = compareToBaseline(
    result.positiveMovePct,
    result.sampleCount,
    baseline.positiveMovePct,
    baseline.sampleCount,
    comparisons,
  );
  const medianDelta = result.medianMovePct - baseline.medianMovePct;
  const needed =
    verdict === 'indistinguishable'
      ? samplesNeeded(result.positiveMovePct, baseline.positiveMovePct, baseline.sampleCount, comparisons)
      : null;

  const tone =
    verdict === 'beats' ? 'text-emerald-400' : verdict === 'worse' ? 'text-rose-400' : 'text-slate-400';

  return (
    <div className="mt-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">so với baseline</p>
      <p className={cx('mt-0.5 text-xs font-semibold tabular-nums', tone)}>
        {signed(deltaPp, 0)}pp tỉ lệ đúng · {signed(medianDelta, 2)}% trung vị
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
      {verdict === 'beats' && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Tốt hơn baseline một cách rõ rệt — đọc tiếp dòng &ldquo;sau phí&rdquo; bên dưới trước khi kết luận là
          giao dịch được.
        </p>
      )}
    </div>
  );
}

/**
 * The same two hit rates counted against the cost of taking the trade.
 *
 * Separate from the block above on purpose: that one answers "did the
 * signal see anything", this one answers "was it worth acting on", and
 * they are different questions with different answers. At 4h the baseline
 * median move is about +0,05% against a round-trip cost near 0,10% — so a
 * card can legitimately beat the baseline and still lose money on every
 * fill, and merging the two would hide exactly that.
 *
 * The down-side rate is shown beside the up-side one because a signal that
 * reliably precedes drops is tradeable too; a short pays the same fee.
 */
function AfterCost({ result, baseline }: { result: PerformanceResult; baseline: PerformanceBaseline }) {
  const cost = result.costPct;
  const up = result.netPositiveMovePct;
  const down = result.netNegativeMovePct;
  const baseUp = baseline.netPositiveMovePct;
  const baseDown = baseline.netNegativeMovePct;

  return (
    <div className="mt-2 rounded border border-slate-800/70 bg-slate-950/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        sau phí (~{cost.toFixed(2).replace('.', ',')}% khứ hồi)
      </p>
      <p className="mt-0.5 text-xs font-semibold tabular-nums text-slate-300">
        {up.toFixed(0)}% đủ lãi khi long · {down.toFixed(0)}% đủ lãi khi short
      </p>
      {baseUp !== null && baseDown !== null && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Baseline sau phí: {baseUp.toFixed(0)}% / {baseDown.toFixed(0)}%. Phần trăm còn lại là những lần giá
          đi chưa đủ để bù phí — đúng hướng vẫn lỗ.
        </p>
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
