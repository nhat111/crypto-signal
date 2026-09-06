/**
 * Whether the BTC/ETH/SOL/HYPE chips belong on this page.
 *
 * They are links into `/symbol/<X>`, but they sit in the header directly
 * above whatever the page is showing — and on Gems that is a `24h / 7d`
 * picker, on Overview a timeframe picker. Read in that position, a row of
 * chips is a filter for the page below, so tapping one on Gems throws the
 * reader into a different section with no warning. That is the bug: not
 * where the link goes, but what the control looks like it does.
 *
 * The fix is to show them only where the four majors are what the page is
 * about, so "go deeper on BTC" is a step the reader was already taking.
 * Small-cap gems, the trade journal, the written guide and the ops status
 * page are about other things entirely, and there the chips are both noise
 * and a trap.
 */
/** The root is handled separately below — it is a prefix of every path. */
const SYMBOL_SCOPED_PAGES = ['/signals', '/performance', '/symbol'];

export function showsSymbolChips(pathname: string): boolean {
  if (pathname === '/') return true;
  // An exact match or a path segment below it — never a bare prefix, or a
  // future /signals-archive would become a symbol page by accident.
  return SYMBOL_SCOPED_PAGES.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}
