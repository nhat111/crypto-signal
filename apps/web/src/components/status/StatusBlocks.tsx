import type { ReactNode } from 'react';
import { cx } from '@/lib/format';
import type { Verdict } from '@/lib/statusVerdicts';

/**
 * The status page is scanned, not read: the operator wants to know whether
 * anything is wrong before they want to know any number. So every row
 * carries a verdict in its own colour, and the numbers explain the verdict
 * rather than being left for the reader to interpret.
 */
const DOT: Record<Verdict, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-400',
  idle: 'bg-slate-600',
};

const TEXT: Record<Verdict, string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
  idle: 'text-slate-500',
};

export function StatusCard({
  title,
  verdict,
  headline,
  children,
}: {
  title: string;
  verdict: Verdict;
  headline: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2">
        <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', DOT[verdict])} />
        <h2 className="text-sm font-bold text-slate-100">{title}</h2>
        <span className={cx('ml-auto text-xs font-semibold', TEXT[verdict])}>{headline}</span>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

export function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: Verdict }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-800/60 py-1.5 last:border-b-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={cx('text-xs font-medium tabular-nums', tone ? TEXT[tone] : 'text-slate-200')}>{value}</span>
    </div>
  );
}

/** Ages are the whole point of this page, and "3m ago" is read faster than a timestamp. */
export function ago(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s trước`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}
