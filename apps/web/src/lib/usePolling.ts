'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  data: T | null;
  error: string | null;
  /** True only until the first successful/failed fetch resolves. */
  loading: boolean;
  refresh: () => void;
}

/**
 * Fetches on mount, then again every `intervalMs`. A poll that fails after
 * we already have data keeps the stale data on screen (with `error` set)
 * rather than blanking the dashboard — a monitoring tool going blank on one
 * missed poll is worse than showing slightly-stale numbers.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback(async (isFirst: boolean) => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (isFirst) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Note: intentionally not resetting `loading` to true here when `deps`
    // change (e.g. switching timeframe) — the previous data stays on screen
    // (stale-while-revalidate) instead of flashing a spinner over it.
    // `loading` only ever tracks the very first fetch after mount.
    void run(true);
    const id = setInterval(() => {
      if (!cancelled) void run(false);
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => void run(false), [run]);

  return { data, error, loading, refresh };
}
