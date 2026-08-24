import type { SafetyVerdict } from '@/lib/types';
import { cx } from '@/lib/format';

interface SafetyBadgeProps {
  /** Null means no screen ran for this chain at all — different from 'unknown', where one ran but confirmed nothing. */
  verdict: SafetyVerdict | null;
}

const STYLES: Record<SafetyVerdict, { label: string; className: string; title: string }> = {
  safe: {
    label: 'Screened',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    title: 'The safety screen found no critical problems. It cannot rule out every risk.',
  },
  caution: {
    label: 'Caution',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    title: 'The safety screen flagged concerns — see the reasons below.',
  },
  danger: {
    label: 'Danger',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    title: 'The safety screen found a critical problem.',
  },
  unknown: {
    label: 'Unverified',
    className: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
    title: 'The safety screen could not be completed — this token is unverified, not confirmed safe.',
  },
};

const NO_SCREEN = {
  label: 'No screen',
  className: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  title: 'No safety screening is available for this chain — this token is unverified, not confirmed safe.',
};

export function SafetyBadge({ verdict }: SafetyBadgeProps) {
  const style = verdict ? STYLES[verdict] : NO_SCREEN;
  return (
    <span
      className={cx('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold', style.className)}
      title={style.title}
    >
      {style.label}
    </span>
  );
}
