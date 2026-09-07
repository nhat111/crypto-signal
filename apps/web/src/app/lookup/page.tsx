'use client';

import { useState } from 'react';
import { ApiError, getLookup } from '@/lib/api';
import type { LookupResponse } from '@/lib/types';
import { LookupResultView } from '@/components/lookup/LookupResultView';
import { StatePanel } from '@/components/StatePanel';
import { cx } from '@/lib/format';

const TIMEFRAMES = ['15m', '1h', '4h'] as const;

/**
 * One box, two worlds.
 *
 * Not polled and not prefetched: every lookup costs somebody else's API
 * call, so it happens when a person asks and not before. The previous
 * result is cleared on failure rather than left standing, since a stale
 * answer beside a fresh error is the worst of both.
 */
export default function LookupPage() {
  const [query, setQuery] = useState('');
  const [timeframe, setTimeframe] = useState<string>('4h');
  const [data, setData] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q === '' || loading) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getLookup(q, timeframe));
    } catch (err) {
      // The API's own reason is the answer here — "no pool on any DEX we
      // cover" and "404" send you to two different places.
      setError(err instanceof ApiError ? err.message : 'Could not run that lookup.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Lookup</h1>
        <p className="mt-1 max-w-2xl text-xs text-slate-500">
          An exchange ticker (BTC, ETHUSDT) or the contract address of an on-chain token. A ticker is read from
          Binance candles; an address is read from its DEX pool and put through a contract safety screen. On-demand
          only: nothing here is stored, and no lookup feeds any performance number in this system.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Ticker or address</span>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none"
              placeholder="BTC · ETHUSDT · 0x… · Solana address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <div>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Timeframe</span>
            <div className="flex overflow-hidden rounded-md border border-slate-700">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={cx(
                    'px-3 py-1.5 text-sm font-semibold transition-colors',
                    timeframe === tf ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-950/60 text-slate-500 hover:text-slate-300',
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || query.trim() === ''}
            className="rounded-md bg-sky-500/90 px-4 py-1.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
          >
            {loading ? 'Looking up…' : 'Look up'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-600">
          The timeframe applies to exchange tickers only — on-chain tokens have no candle history from the free
          data source.
        </p>
      </form>

      {error && <StatePanel tone="error" title="No result" detail={error} />}
      {data && <LookupResultView result={data.result} />}
    </div>
  );
}
