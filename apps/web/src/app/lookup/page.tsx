'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError, getLookup } from '@/lib/api';
import type { LookupResponse } from '@/lib/types';
import { LookupResultView } from '@/components/lookup/LookupResultView';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';
import { cx } from '@/lib/format';
import { LOOKUP_TIMEFRAMES, lookupSearch, parseLookupParams } from '@/lib/lookupChart';

/**
 * One box, two worlds.
 *
 * Not polled and not prefetched: every lookup costs somebody else's API
 * call, so it happens when a person asks and not before. The previous
 * result is cleared on failure rather than left standing, since a stale
 * answer beside a fresh error is the worst of both.
 */
export default function LookupPage() {
  // useSearchParams suspends during prerender; the boundary keeps that to
  // this page's content instead of client-rendering the whole route.
  return (
    <Suspense fallback={<LoadingPanel label="Loading lookup…" />}>
      <LookupContent />
    </Suspense>
  );
}

function LookupContent() {
  const params = useSearchParams();
  // `/lookup?q=NEARUSDT&tf=1h` (the bot's "Xem chart" link) answers on
  // open. Read once into the initial state: after that the URL follows the
  // form, not the reverse.
  const [initial] = useState(() => parseLookupParams(new URLSearchParams(params.toString())));
  const [query, setQuery] = useState(initial.q);
  const [timeframe, setTimeframe] = useState<string>(initial.tf);
  const [data, setData] = useState<LookupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial.q !== '');
  const openedFromLink = useRef(false);

  useEffect(() => {
    if (openedFromLink.current || initial.q === '') return;
    openedFromLink.current = true;
    fetchLookup(initial.q, initial.tf).then(({ data: d, error: e }) => {
      setData(d);
      setError(e);
      setLoading(false);
    });
  }, [initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q === '' || loading) return;
    // Keep the address bar on the current answer, so it can be shared.
    window.history.replaceState(null, '', `/lookup${lookupSearch({ q, tf: timeframe })}`);
    setLoading(true);
    setError(null);
    const result = await fetchLookup(q, timeframe);
    setData(result.data);
    setError(result.error);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Lookup</h1>
        <p className="mt-1 max-w-2xl text-xs text-slate-500">
          Nhập mã trên sàn (BTC, ETHUSDT) hoặc địa chỉ contract của một token on-chain. Mã sàn được đọc từ nến
          Binance; địa chỉ được đọc từ pool DEX của nó rồi cho qua một lượt quét an toàn hợp đồng. Chỉ tra khi bro
          gõ: không lưu gì ở đây, và không có kết quả tra cứu nào chảy vào các con số hiệu quả của hệ thống.
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
              {LOOKUP_TIMEFRAMES.map((tf) => (
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
          Khung thời gian chỉ áp dụng cho mã trên sàn — token on-chain không có lịch sử nến từ nguồn dữ liệu miễn phí.
        </p>
      </form>

      {error && <StatePanel tone="error" title="No result" detail={error} />}
      {data && <LookupResultView result={data.result} />}
    </div>
  );
}

/**
 * One lookup, as the page shows it. On failure the previous result is
 * cleared rather than left standing, since a stale answer beside a fresh
 * error is the worst of both.
 */
async function fetchLookup(q: string, tf: string): Promise<{ data: LookupResponse | null; error: string | null }> {
  try {
    return { data: await getLookup(q, tf), error: null };
  } catch (err) {
    // The API's own reason is the answer here — "no pool on any DEX we
    // cover" and "404" send you to two different places.
    return { data: null, error: err instanceof ApiError ? err.message : 'Không tra cứu được. Thử lại sau ít phút.' };
  }
}
