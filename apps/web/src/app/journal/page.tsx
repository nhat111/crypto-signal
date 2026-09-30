'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { getTradeSources, getTradeSummary, getTrades } from '@/lib/api';
import { parseTradePrefill, type TradePrefill } from '@/lib/journalPrefill';
import { usePolling } from '@/lib/usePolling';
import { JournalSources } from '@/components/journal/JournalSources';
import { JournalSummary } from '@/components/journal/JournalSummary';
import { TradeForm } from '@/components/journal/TradeForm';
import { TradeTable } from '@/components/journal/TradeTable';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 20_000;

/**
 * useSearchParams suspends during prerender, so the reader lives below a
 * boundary rather than at the page root — without it the whole journal
 * would be client-rendered on every load just to read an optional param.
 */
export default function JournalPage() {
  return (
    <Suspense fallback={<LoadingPanel label="Loading journal…" />}>
      <JournalContent />
    </Suspense>
  );
}

function JournalContent() {
  const tradesFetcher = useCallback(() => getTrades(200), []);
  const summaryFetcher = useCallback(() => getTradeSummary(), []);
  // Its own poll, and its failure is its own: an API that predates the
  // endpoint 404s here, and that must not take the rest of the journal down.
  const sourcesFetcher = useCallback(() => getTradeSources(), []);
  const trades = usePolling(tradesFetcher, POLL_MS, []);
  const summary = usePolling(summaryFetcher, POLL_MS, []);
  const sources = usePolling(sourcesFetcher, POLL_MS, []);
  const prefill = usePrefill();

  const refreshAll = () => {
    trades.refresh();
    summary.refresh();
    sources.refresh();
  };

  const knownSources = (sources.data?.sources ?? []).flatMap((s) => (s.source === null ? [] : [s.source]));

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
          <TradeForm
            // Remount on a new draft rather than syncing state in an
            // effect: the form is uncontrolled once open, and a new draft
            // means a new form.
            key={prefill === null ? 'blank' : `${prefill.symbol}:${prefill.entryPrice}:${prefill.side}`}
            onCreated={refreshAll}
            prefill={prefill}
            knownSources={knownSources}
          />
          {sources.data && <JournalSources sources={sources.data.sources} minClosed={sources.data.minClosed} />}
          <TradeTable trades={trades.data?.trades ?? []} onChanged={refreshAll} nowMs={trades.data?.serverTime ?? null} />
        </>
      )}
    </div>
  );
}

/** Thin wrapper: the parsing itself is pure and tested in lib/journalPrefill. */
function usePrefill(): TradePrefill | null {
  const params = useSearchParams();
  const search = params.toString();
  return useMemo(() => parseTradePrefill(new URLSearchParams(search)), [search]);
}
