import { HEALTH_BAND_LABEL, HEALTH_COLORS, HEALTH_NA_COLORS } from '@/lib/health';
import type { HealthStatus } from '@/lib/types';
import { cx, formatScore } from '@/lib/format';

interface HealthBadgeProps {
  /** Null for futures-only symbols (no Binance Spot listing) — Health Score needs a spot leg to compare against. */
  score: number | null;
  status: HealthStatus | null;
  size?: 'sm' | 'md' | 'lg';
}

/** Health score + status label, colored per spec §2 band. Used identically everywhere a health score appears. Renders "N/A" for futures-only symbols rather than a fabricated score. */
export function HealthBadge({ score, status, size = 'md' }: HealthBadgeProps) {
  const colors = status ? HEALTH_COLORS[status] : HEALTH_NA_COLORS;
  const sizeClasses =
    size === 'lg'
      ? 'text-3xl px-3 py-1.5'
      : size === 'sm'
        ? 'text-xs px-1.5 py-0.5'
        : 'text-sm px-2 py-1';

  const label = status ? HEALTH_BAND_LABEL[status] : 'N/A';

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border font-semibold tabular-nums',
        colors.bg,
        colors.border,
        colors.text,
        sizeClasses,
      )}
      title={status ? `Health ${label} band` : 'No Health Score — futures-only symbol, no Spot listing on Binance'}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', colors.dot)} />
      {score === null ? 'N/A' : formatScore(score)}
      {size !== 'sm' && <span className="font-medium opacity-80">{label}</span>}
    </span>
  );
}
