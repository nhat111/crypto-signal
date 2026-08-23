'use client';

import { useCallback, useState } from 'react';
import { getSignals } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import type { SignalType, Timeframe } from '@/lib/types';
import { SignalFilters, type SignalFilterState } from '@/components/signals/SignalFilters';
import { SignalList } from '@/components/signals/SignalList';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 20_000;
const LIST_LIMIT = 100;

export default function SignalsPage() {
  const [filters, setFilters] = useState<SignalFilterState>({ symbol: '', timeframe: '', signalType: '' });

  const fetcher = useCallback(
    () =>
      getSignals({
        symbol: filters.symbol || undefined,
        timeframe: (filters.timeframe || undefined) as Timeframe | undefined,
        signalType: (filters.signalType || undefined) as SignalType | undefined,
        limit: LIST_LIMIT,
      }),
    [filters.symbol, filters.timeframe, filters.signalType],
  );

  const signals = usePolling(fetcher, POLL_MS, [filters.symbol, filters.timeframe, filters.signalType]);
  const isBootstrapping = signals.loading && !signals.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-100">Signals</h1>
        <SignalFilters value={filters} onChange={setFilters} />
      </div>

      {isBootstrapping ? (
        <LoadingPanel label="Loading signals…" />
      ) : signals.error && !signals.data ? (
        <StatePanel tone="error" title="Could not reach the API" detail={signals.error} />
      ) : (
        <SignalList signals={signals.data?.signals ?? []} emptyLabel="No signals match these filters." />
      )}
    </div>
  );
}
