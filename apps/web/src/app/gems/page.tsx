'use client';

import { useCallback, useState } from 'react';
import { getGemPerformance, getGems } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import type { GemHorizon } from '@/lib/types';
import { GemCard } from '@/components/gems/GemCard';
import { GemPerformancePanel } from '@/components/gems/PerformancePanels';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';
import { cx } from '@/lib/format';

const POLL_MS = 60_000;
const LIST_LIMIT = 60;
const HORIZONS: GemHorizon[] = ['24h', '7d'];

export default function GemsPage() {
  const [horizon, setHorizon] = useState<GemHorizon>('7d');

  const gemsFetcher = useCallback(() => getGems({ limit: LIST_LIMIT }), []);
  const gems = usePolling(gemsFetcher, POLL_MS, []);

  const perfFetcher = useCallback(() => getGemPerformance(horizon), [horizon]);
  const performance = usePolling(perfFetcher, POLL_MS, [horizon]);

  const isBootstrapping = gems.loading && !gems.data;
  const list = gems.data?.gems ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Small-cap candidates</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Tokens from public DEX data that fit a small-cap profile and have already survived a while. These are
          screening results, not recommendations — small caps can lose most or all of their value quickly, and a
          safety screen cannot rule out every risk.
        </p>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-200">Has this scanner actually worked?</h2>
          <div className="flex gap-1">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={cx(
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  h === horizon ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <GemPerformancePanel data={performance.data} loading={performance.loading} error={performance.error} />
      </section>

      {isBootstrapping ? (
        <LoadingPanel label="Loading candidates…" />
      ) : gems.error && !gems.data ? (
        <StatePanel tone="error" title="Could not reach the API" detail={gems.error} />
      ) : list.length === 0 ? (
        <StatePanel
          title="No candidates right now"
          detail="Either the scanner is disabled, has not run yet, or nothing in its sample passed the filters."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {list.map((gem) => (
            <GemCard key={gem.scanId} gem={gem} />
          ))}
        </div>
      )}
    </div>
  );
}
