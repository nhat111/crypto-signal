import { HEALTH_BAND_LABEL, HEALTH_COLORS } from '@/lib/health';
import type { HealthStatus } from '@/lib/types';
import { cx, formatScore } from '@/lib/format';

interface HealthBadgeProps {
  score: number;
  status: HealthStatus;
  size?: 'sm' | 'md' | 'lg';
}

/** Health score + status label, colored per spec §2 band. Used identically everywhere a health score appears. */
export function HealthBadge({ score, status, size = 'md' }: HealthBadgeProps) {
  const colors = HEALTH_COLORS[status];
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
      title={`Health ${HEALTH_BAND_LABEL[status]} (${HEALTH_BAND_LABEL[status]} band)`}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', colors.dot)} />
      {formatScore(score)}
      {size !== 'sm' && <span className="font-medium opacity-80">{HEALTH_BAND_LABEL[status]}</span>}
    </span>
  );
}
