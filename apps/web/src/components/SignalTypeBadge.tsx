import { SIGNAL_TONE_DOT, SIGNAL_TYPE_TONE, signalTypeLabel } from '@/lib/severity';
import type { SignalType } from '@/lib/types';
import { cx } from '@/lib/format';

interface SignalTypeBadgeProps {
  signalType: SignalType;
  className?: string;
}

/** Signal type label with a small tone dot, distinct from SeverityBadge so type and severity never blur together. */
export function SignalTypeBadge({ signalType, className }: SignalTypeBadgeProps) {
  // Falls back to the caution dot for a type this build predates.
  const tone = SIGNAL_TYPE_TONE[signalType] ?? 'caution';
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-medium text-slate-200', className)}>
      <span className={cx('h-2 w-2 shrink-0 rounded-full', SIGNAL_TONE_DOT[tone])} />
      {signalTypeLabel(signalType)}
    </span>
  );
}
