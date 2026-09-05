'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { getFlow, getOverview, getSignals } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { useSymbolSnapshots } from '@/lib/useSymbolSnapshots';
import type { Signal } from '@/lib/types';
import { SymbolCard } from '@/components/overview/SymbolCard';
import { TimeframePicker } from '@/components/overview/TimeframePicker';
import {
  getServerTimeframe,
  getStoredTimeframe,
  pickOverviewTimeframe,
  storeTimeframe,
  subscribeStoredTimeframe,
} from '@/lib/timeframe';
import { Heatmap } from '@/components/overview/Heatmap';
import { MacroFlowBar } from '@/components/overview/MacroFlowBar';
import { SignalList } from '@/components/signals/SignalList';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 20_000;
const FLOW_POLL_MS = 10 * 60_000;

export default function OverviewPage() {
  const overview = usePolling(getOverview, POLL_MS, []);
  const signals = usePolling(() => getSignals({ limit: 20 }), POLL_MS, []);
  // Daily data — polled far less often than the market panels above it.
  const flow = usePolling(getFlow, FLOW_POLL_MS, []);

  const symbols = overview.data?.symbols ?? [];
  const available = overview.data?.timeframes ?? [];

  // The frame is resolved from whatever the API actually collects, not from
  // a constant that goes stale. Null means "reader has not chosen", which is
  // also what the prerender sees.
  const chosen = useSyncExternalStore(subscribeStoredTimeframe, getStoredTimeframe, getServerTimeframe);
  const timeframe = pickOverviewTimeframe(chosen, available);

  const snapshots = useSymbolSnapshots(symbols, timeframe, POLL_MS);

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
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-100">Market Overview</h1>
          <PollStatus loading={overview.loading} error={overview.error} />
        </div>

        {available.length > 0 && (
          <div className="mb-4">
            <TimeframePicker
              available={available}
              value={timeframe}
              onChange={storeTimeframe}
            />
          </div>
        )}

        {!isBootstrapping && <div className="mb-4"><MacroFlowBar flow={flow.data?.stablecoin ?? null} fetch={flow.data?.fetch ?? null} /></div>}

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
                (r) => r.symbol === symbol && r.timeframe === timeframe,
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
            Health score by symbol × timeframe. Color reflects the band only — the number is the source of truth. N/A
            means the symbol has no Binance spot listing, not that data is missing.
          </p>
          <Heatmap symbols={overview.data.symbols} timeframes={overview.data.timeframes} rows={overview.data.rows} />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-slate-100">Tín hiệu gần đây</h2>
          <a href="/signals" className="text-xs font-medium text-sky-400 hover:text-sky-300">
            Xem tất cả →
          </a>
        </div>
        {signals.loading && !signals.data ? (
          <LoadingPanel label="Đang tải tín hiệu…" />
        ) : (
          <SignalList
            signals={signals.data?.signals ?? []}
            verdicts={signals.data?.verdicts}
            emptyLabel="Chưa có tín hiệu nào."
          />
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
