'use client';

import { useCallback, useState } from 'react';
import { getPerformance } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { UNREPLAYABLE_SIGNAL_TYPES, type Horizon, type PerformanceSource } from '@/lib/types';
import { HorizonSwitcher } from '@/components/performance/HorizonSwitcher';
import { PerformanceCard } from '@/components/performance/PerformanceCard';
import { BaselinePanel } from '@/components/performance/BaselinePanel';
import { SourceSwitcher } from '@/components/performance/SourceSwitcher';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 60_000;

export default function PerformancePage() {
  const [horizon, setHorizon] = useState<Horizon>('1h');
  const [source, setSource] = useState<PerformanceSource>('live');
  const fetcher = useCallback(() => getPerformance(horizon, source), [horizon, source]);
  const performance = usePolling(fetcher, POLL_MS, [horizon, source]);
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
        <div className="flex flex-wrap items-start gap-3">
          <HorizonSwitcher value={horizon} onChange={setHorizon} />
          <SourceSwitcher value={source} onChange={setSource} />
        </div>
      </div>

      {isBootstrapping ? (
        <LoadingPanel label="Loading performance data…" />
      ) : performance.error && !performance.data ? (
        <StatePanel tone="error" title="Could not reach the API" detail={performance.error} />
      ) : (
        <>
          {source !== 'live' && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/80">
              Replayed samples come from re-running the engine over historical market data. They are real
              measurements, but of a weaker thing: no liquidation history exists upstream, so{' '}
              <span className="font-semibold">{UNREPLAYABLE_SIGNAL_TYPES.join(' and ')}</span> cannot fire at all
              here — a zero for those means unmeasurable, not that the pattern never occurred. Open interest only
              reaches back 30 days, which bounds how far the replay can go.
            </div>
          )}
          {/* A page that says "not enough data" while thousands of replayed
              outcomes sit one click away is a dead end pretending to be an
              answer. The switcher above is easy to miss, so when the
              selected source has nothing usable, say where the data is. */}
          {source === 'live' &&
            performance.data &&
            performance.data.results.every((r) => !r.sufficientData) && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs leading-relaxed text-sky-200/80">
                Chưa tín hiệu nào đủ mẫu ở nguồn <span className="font-semibold">Live</span>. Dữ liệu{' '}
                <button
                  type="button"
                  onClick={() => setSource('backfill')}
                  className="font-semibold text-sky-300 underline decoration-sky-500/50 underline-offset-2"
                >
                  Replay
                </button>{' '}
                tính lại engine trên 30 ngày lịch sử nên thường có nhiều mẫu hơn — kèm cảnh báo về những gì nó không
                đo được.
              </div>
            )}
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
