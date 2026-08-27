'use client';

import { useCallback, useState } from 'react';
import { getPerformance } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import type { Horizon } from '@/lib/types';
import { HorizonSwitcher } from '@/components/performance/HorizonSwitcher';
import { PerformanceCard } from '@/components/performance/PerformanceCard';
import { BaselinePanel } from '@/components/performance/BaselinePanel';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 60_000;

export default function PerformancePage() {
  const [horizon, setHorizon] = useState<Horizon>('1h');
  const fetcher = useCallback(() => getPerformance(horizon), [horizon]);
  const performance = usePolling(fetcher, POLL_MS, [horizon]);
  const isBootstrapping = performance.loading && !performance.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Historical Signal Performance</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            What happened to price after each signal type fired, at the selected horizon. Figures only render
            once a signal type has at least 30 recorded outcomes — otherwise this refuses to claim edge that
            isn&apos;t backed by evidence yet. Read every card against the baseline below it: a hit rate only
            means something if it beats what price did anyway over the same window.
          </p>
        </div>
        <HorizonSwitcher value={horizon} onChange={setHorizon} />
      </div>

      {isBootstrapping ? (
        <LoadingPanel label="Loading performance data…" />
      ) : performance.error && !performance.data ? (
        <StatePanel tone="error" title="Could not reach the API" detail={performance.error} />
      ) : (
        <>
          {performance.data && <BaselinePanel baseline={performance.data.baseline} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {performance.data?.results.map((result) => (
              <PerformanceCard key={result.signalType} result={result} baseline={performance.data!.baseline} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
