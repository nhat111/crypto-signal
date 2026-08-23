import { riskColorClass } from '@/lib/health';
import { cx, formatScore } from '@/lib/format';

interface RiskBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

/** Leverage risk score. No named bands in the spec, so it reuses the health ramp mirrored (high risk = red). */
export function RiskBadge({ score, size = 'md' }: RiskBadgeProps) {
  const colors = riskColorClass(score);
  const sizeClasses =
    size === 'lg'
      ? 'text-3xl px-3 py-1.5'
      : size === 'sm'
        ? 'text-xs px-1.5 py-0.5'
        : 'text-sm px-2 py-1';

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border font-semibold tabular-nums',
        colors.bg,
        colors.border,
        colors.text,
        sizeClasses,
      )}
      title="Leverage risk score (higher = more leverage-driven risk)"
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', colors.dot)} />
      {formatScore(score)}
    </span>
  );
}
