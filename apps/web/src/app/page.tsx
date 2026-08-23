'use client';

import { useMemo } from 'react';
import { getOverview, getSignals } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { useSymbolSnapshots } from '@/lib/useSymbolSnapshots';
import type { Signal, Timeframe } from '@/lib/types';
import { SymbolCard } from '@/components/overview/SymbolCard';
import { Heatmap } from '@/components/overview/Heatmap';
import { SignalList } from '@/components/signals/SignalList';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 20_000;
const DEFAULT_TIMEFRAME: Timeframe = '15m';

export default function OverviewPage() {
  const overview = usePolling(getOverview, POLL_MS, []);
  const signals = usePolling(() => getSignals({ limit: 20 }), POLL_MS, []);

  const symbols = overview.data?.symbols ?? [];
  const snapshots = useSymbolSnapshots(symbols, DEFAULT_TIMEFRAME, POLL_MS);

  const activeSignalsBySymbol = useMemo(() => {
    const map = new Map<string, Signal[]>();
    for (const signal of signals.data?.signals ?? []) {
      const list = map.get(signal.symbol) ?? [];
      list.push(signal);
      map.set(signal.symbol, list);
    }
    return map;
  }, [signals.data]);

  const isBootstrapping = overview.loading && !overview.data;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-slate-100">Market Overview</h1>
          <PollStatus loading={overview.loading} error={overview.error} />
        </div>

        {isBootstrapping ? (
          <LoadingPanel label="Loading market overview…" />
        ) : overview.error && !overview.data ? (
          <StatePanel
            tone="error"
            title="Could not reach the API"
            detail={overview.error}
          />
        ) : symbols.length === 0 ? (
          <StatePanel
            title="Waiting for data"
            detail="The collector may still be warming up — this fills in within a few minutes of the worker running."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {symbols.map((symbol) => {
              const row = overview.data?.rows.find(
                (r) => r.symbol === symbol && r.timeframe === DEFAULT_TIMEFRAME,
              );
              const symbolSignals = activeSignalsBySymbol.get(symbol) ?? [];
              return (
                <SymbolCard
                  key={symbol}
                  symbol={symbol}
                  overviewRow={row}
                  snapshot={snapshots.data?.[symbol]}
                  activeSignalCount={symbolSignals.length}
                  latestSignal={symbolSignals[0]}
                />
              );
            })}
          </div>
        )}
      </section>

      {overview.data && overview.data.rows.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-slate-100">Health Heatmap</h2>
          <p className="mb-3 text-xs text-slate-500">
            Health score by symbol × timeframe. Color reflects the band only — the number is the source of truth.
          </p>
          <Heatmap symbols={overview.data.symbols} timeframes={overview.data.timeframes} rows={overview.data.rows} />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-slate-100">Recent Signals</h2>
          <a href="/signals" className="text-xs font-medium text-sky-400 hover:text-sky-300">
            View all →
          </a>
        </div>
        {signals.loading && !signals.data ? (
          <LoadingPanel label="Loading signals…" />
        ) : (
          <SignalList signals={signals.data?.signals ?? []} emptyLabel="No signals fired yet." />
        )}
      </section>
    </div>
  );
}

function PollStatus({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) {
    return <span className="text-xs font-medium text-amber-400">stale — {error}</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className={`h-1.5 w-1.5 rounded-full ${loading ? 'animate-pulse bg-sky-400' : 'bg-emerald-400'}`} />
      live
    </span>
  );
}
