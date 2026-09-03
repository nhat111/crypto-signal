import { SignalRow } from './SignalRow';
import { StatePanel } from '@/components/StatePanel';
import { SIGNAL_TYPE_LABEL } from '@/lib/severity';
import type { Signal, SignalType, SignalVerdict } from '@/lib/types';

interface SignalListProps {
  signals: Signal[];
  showSymbol?: boolean;
  emptyLabel?: string;
  /** What the recorded outcomes concluded about each type; absent when the API predates them. */
  verdicts?: SignalVerdict[];
}

export function SignalList({
  signals,
  showSymbol = true,
  emptyLabel = 'Chưa có tín hiệu nào.',
  verdicts,
}: SignalListProps) {
  if (signals.length === 0) {
    return <StatePanel title={emptyLabel} detail="Tín hiệu sẽ hiện ở đây ngay khi engine bật một cái." />;
  }

  const byType = new Map<SignalType, SignalVerdict>((verdicts ?? []).map((v) => [v.signalType, v]));
  const present = new Set(signals.map((s) => s.signalType));
  const flagged = [...byType.values()].filter((v) => v.verdict === 'worse' && present.has(v.signalType));

  return (
    <>
      <VerdictBanner flagged={flagged} />
      <ul className="space-y-2">
        {signals.map((signal) => (
          <SignalRow
            key={signal.signalId}
            signal={signal}
            showSymbol={showSymbol}
            flagged={byType.get(signal.signalType)?.verdict === 'worse'}
          />
        ))}
      </ul>
    </>
  );
}

/**
 * The conclusions, once, above the list.
 *
 * Not once per row: a type that fires often would paper the page with the
 * same paragraph, and a warning repeated forty times is a warning nobody
 * reads. The numbers and the link live here; each affected row carries a
 * chip so it is still obvious which rows this is about.
 *
 * Only types actually present in the list are named — a standing notice
 * about a type that has not fired is noise about nothing.
 */
function VerdictBanner({ flagged }: { flagged: SignalVerdict[] }) {
  if (flagged.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/80">
      <p className="font-semibold text-amber-200">
        {flagged.length === 1 ? 'Một loại tín hiệu dưới đây' : `${flagged.length} loại tín hiệu dưới đây`} đang
        kém hơn mức nền
      </p>
      <ul className="mt-1.5 space-y-1">
        {flagged.map((v) => (
          <li key={v.signalType}>
            <span className="font-semibold">{SIGNAL_TYPE_LABEL[v.signalType]}</span>: {v.hitPct.toFixed(0)}% đúng
            so với baseline {v.baselinePct.toFixed(0)}%, trên {v.sampleCount.toLocaleString('vi-VN')} mẫu ở khung{' '}
            {v.horizon}.
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-amber-200/60">
        Nghĩa là giá sau tín hiệu đi kém hơn cả khi không làm gì — không phải &ldquo;hãy đảo chiều&rdquo;, mà là
        &ldquo;đừng dùng cái này làm lý do vào lệnh&rdquo;.{' '}
        <a href="/performance" className="underline decoration-amber-500/50 underline-offset-2 hover:text-amber-100">
          Xem bằng chứng
        </a>
      </p>
    </div>
  );
}
