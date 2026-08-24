'use client';

import { useCallback, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { getSymbolDetail } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { TIMEFRAMES, type Timeframe } from '@/lib/types';
import { SymbolHeader } from '@/components/symbol/SymbolHeader';
import { TimeframeSwitcher } from '@/components/symbol/TimeframeSwitcher';
import { ChartsGrid } from '@/components/symbol/ChartsGrid';
import { SignalList } from '@/components/signals/SignalList';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 15_000;
const HISTORY_LIMIT = 200;

function isTimeframe(value: string | null): value is Timeframe {
  return !!value && (TIMEFRAMES as readonly string[]).includes(value);
}

export default function SymbolDetailPage() {
  const params = useParams<{ symbol: string }>();
  const searchParams = useSearchParams();
  const symbol = (params.symbol ?? '').toUpperCase();

  // Seeded once from the URL (e.g. a heatmap cell linking to a specific
  // timeframe); the switcher takes over from there, same as any other local state.
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const fromQuery = searchParams.get('timeframe');
    return isTimeframe(fromQuery) ? fromQuery : '15m';
  });

  const fetcher = useCallback(
    () => getSymbolDetail(symbol, timeframe, HISTORY_LIMIT),
    [symbol, timeframe],
  );
  const detail = usePolling(fetcher, POLL_MS, [symbol, timeframe]);

  const isBootstrapping = detail.loading && !detail.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {detail.data?.latest ? (
          <SymbolHeader symbol={symbol} latest={detail.data.latest} priceLevels={detail.data.priceLevels} />
        ) : (
          <h1 className="text-xl font-bold text-slate-100">{symbol}</h1>
        )}
        <TimeframeSwitcher value={timeframe} onChange={setTimeframe} />
      </div>

      {isBootstrapping ? (
        <LoadingPanel label={`Loading ${symbol} ${timeframe}…`} />
      ) : detail.error && !detail.data ? (
        <StatePanel tone="error" title="Could not reach the API" detail={detail.error} />
      ) : !detail.data?.latest ? (
        <StatePanel
          title="Waiting for data"
          detail={`No snapshot yet for ${symbol} on ${timeframe}. The collector may still be warming up.`}
        />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Charts</h2>
            <ChartsGrid points={detail.data.series} signals={detail.data.signals} />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
              Signals ({timeframe})
            </h2>
            <SignalList
              signals={detail.data.signals}
              showSymbol={false}
              emptyLabel={`No signals for ${symbol} on ${timeframe} yet.`}
            />
          </section>
        </>
      )}
    </div>
  );
}
