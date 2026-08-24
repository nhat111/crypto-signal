'use client';

import { getOverview } from './api';
import { usePolling } from './usePolling';

/** Symbols change only when the worker's config changes, so this polls far less often than the dashboards do. */
const POLL_MS = 5 * 60_000;

/**
 * The symbols the collector is actually tracking, straight from the API
 * (which reads them from the database the worker writes).
 *
 * Anywhere that needs a symbol list must use this rather than a literal
 * array — a hard-coded list silently omits any symbol added later, which is
 * exactly how HYPEUSDT ended up missing from the nav and the signal filter
 * after it was added to the worker's config.
 */
export function useTrackedSymbols(): string[] {
  const overview = usePolling(getOverview, POLL_MS, []);
  return overview.data?.symbols ?? [];
}
