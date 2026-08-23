import { SEVERITY_COLORS } from '@/lib/severity';
import type { Severity } from '@/lib/types';
import { cx } from '@/lib/format';

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

/** Severity chip — the visual weight (ring + saturation) scales with severity so HIGH/EXTREME jump out at a glance. */
export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const colors = SEVERITY_COLORS[severity];
  const isLoud = severity === 'HIGH' || severity === 'EXTREME';
  return (
    <span
      className={cx(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        colors.bg,
        colors.text,
        'border',
        colors.border,
        isLoud && 'ring-1',
        isLoud && colors.ring,
        className,
      )}
    >
      {severity}
    </span>
  );
}
