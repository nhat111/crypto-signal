'use client';

import { useCallback } from 'react';
import { getSymbolDetail } from './api';
import { usePolling } from './usePolling';
import type { SymbolLatest, Timeframe } from './types';

/**
 * /api/overview carries health/risk/price but not CVD/OI/funding/
 * liquidations (API_CONTRACT.md), so the overview cards fetch each symbol's
 * `latest` snapshot separately, in parallel, at a fixed representative
 * timeframe. limit=1 keeps the payload to just `latest`.
 */
export function useSymbolSnapshots(symbols: string[], timeframe: Timeframe, intervalMs: number) {
  const fetcher = useCallback(async () => {
    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const detail = await getSymbolDetail(symbol, timeframe, 1);
          return [symbol, detail.latest] as const;
        } catch {
          return [symbol, null] as const;
        }
      }),
    );
    return Object.fromEntries(entries) as Record<string, SymbolLatest | null>;
  }, [symbols, timeframe]);

  return usePolling(fetcher, intervalMs, [symbols.join(','), timeframe]);
}
