'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/lib/format';

/**
 * Sub-nav for the two guides. They answer different questions — one is
 * "what do the numbers on this dashboard mean", the other is "how do I
 * read a chart at all" — and a reader who lands on the wrong one has no
 * way to discover the other from the top nav, which shows a single
 * "Guide" entry.
 */
const TABS = [
  { href: '/guide', label: 'Đọc dashboard' },
  { href: '/guide/ta', label: 'Học phân tích kỹ thuật' },
  { href: '/guide/methodology', label: 'Phương pháp' },
];

export function GuideTabs() {
  const pathname = usePathname();

  return (
    <nav className="mt-5 flex flex-wrap gap-1.5">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cx(
              'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-200'
                : 'border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
