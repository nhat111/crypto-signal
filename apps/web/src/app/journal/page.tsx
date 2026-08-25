'use client';

import { useCallback } from 'react';
import { getTradeSummary, getTrades } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { JournalSummary } from '@/components/journal/JournalSummary';
import { TradeForm } from '@/components/journal/TradeForm';
import { TradeTable } from '@/components/journal/TradeTable';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 20_000;

export default function JournalPage() {
  const tradesFetcher = useCallback(() => getTrades(200), []);
  const summaryFetcher = useCallback(() => getTradeSummary(), []);
  const trades = usePolling(tradesFetcher, POLL_MS, []);
  const summary = usePolling(summaryFetcher, POLL_MS, []);

  const refreshAll = () => {
    trades.refresh();
    summary.refresh();
  };

  const isBootstrapping = (trades.loading && !trades.data) || (summary.loading && !summary.data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Trade Journal</h1>
        <p className="mt-1 max-w-2xl text-xs text-slate-500">
          A manual log of trades you actually took — on BTC/ETH/SOL/HYPE or any gem. Independent of the signal
          engine and the gem scanner: nothing here is auto-generated, it&apos;s only what you logged, from the
          web form or <code className="rounded bg-slate-900 px-1 py-0.5">/trade</code> on the bot.
        </p>
      </div>

      {isBootstrapping ? (
        <LoadingPanel label="Loading journal…" />
      ) : trades.error && !trades.data ? (
        <StatePanel tone="error" title="Could not reach the API" detail={trades.error} />
      ) : (
        <>
          {summary.data && <JournalSummary summary={summary.data.summary} />}
          <TradeForm onCreated={refreshAll} />
          <TradeTable trades={trades.data?.trades ?? []} onChanged={refreshAll} />
        </>
      )}
    </div>
  );
}
