import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

interface StatePanelProps {
  title: string;
  detail?: string;
  icon?: ReactNode;
  tone?: 'neutral' | 'error';
  className?: string;
}

/**
 * Shared "nothing to show yet" panel — used for loading, empty, and error
 * states so the dashboard never renders a blank white screen, e.g. right
 * after the collector starts and /api/overview has few or zero rows.
 */
export function StatePanel({ title, detail, icon, tone = 'neutral', className }: StatePanelProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center',
        tone === 'error' ? 'border-red-500/30 bg-red-500/5' : 'border-slate-700 bg-slate-900/40',
        className,
      )}
    >
      {icon && <div className="text-2xl">{icon}</div>}
      <p className={cx('text-sm font-medium', tone === 'error' ? 'text-red-300' : 'text-slate-300')}>
        {title}
      </p>
      {detail && <p className="max-w-md text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-6 py-10 text-sm text-slate-400">
      <span className="h-3 w-3 animate-pulse rounded-full bg-sky-400" />
      {label}
    </div>
  );
}
