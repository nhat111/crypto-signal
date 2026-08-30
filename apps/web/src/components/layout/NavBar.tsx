'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/lib/format';
import { useTrackedSymbols } from '@/lib/useTrackedSymbols';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/signals', label: 'Signals' },
  { href: '/gems', label: 'Gems' },
  { href: '/journal', label: 'Journal' },
  { href: '/performance', label: 'Performance' },
  { href: '/guide', label: 'Guide' },
  { href: '/status', label: 'Status' },
];

/** Top nav: section links + quick jumps to each symbol's detail page. */
export function NavBar() {
  const pathname = usePathname();
  const symbols = useTrackedSymbols();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-sm font-bold tracking-tight text-slate-100">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
          Market Health Monitor
        </Link>

        {/* Wraps. Without this the row overflowed the viewport on a phone
            once the link count grew, and the links past the fold were not
            merely cramped — they were unreachable, with the whole page
            scrolling sideways to reach them. */}
        <nav className="flex flex-wrap items-center gap-1">
          {LINKS.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* ml-auto only once there is room for it: on a narrow screen it
            shoved the symbol chips against the right edge of an already
            overflowing row. */}
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
          {symbols.map((symbol) => {
            const active = pathname === `/symbol/${symbol}`;
            return (
              <Link
                key={symbol}
                href={`/symbol/${symbol}`}
                className={cx(
                  'rounded-md border px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors',
                  active
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                    : 'border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200',
                )}
              >
                {symbol.replace('USDT', '')}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
