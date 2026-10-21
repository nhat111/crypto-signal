'use client';

import { useState } from 'react';
import { cx, formatPct, formatUsd } from '@/lib/format';
import type { AirdropCandidate, Farm } from '@/lib/types';

const MAX_CHAINS = 4;

function pctClass(value: number | null): string {
  if (value === null) return 'text-slate-500';
  return value >= 0 ? 'text-emerald-300' : 'text-rose-300';
}

/** One tokenless protocol: what it is, why it is listed, and what is not known. */
export function CandidateCard({
  candidate,
  farm,
  onFarm,
}: {
  candidate: AirdropCandidate;
  farm: Farm | undefined;
  onFarm: (candidate: AirdropCandidate) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extraChains = candidate.chains.length - MAX_CHAINS;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await onFarm(candidate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-100">{candidate.name}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {candidate.category ?? 'Không rõ mảng'}
            {' · '}
            {candidate.chains.slice(0, MAX_CHAINS).join(', ')}
            {extraChains > 0 && ` +${extraChains}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-100">{formatUsd(candidate.tvlUsd)}</p>
          <p className="text-[11px] text-slate-500">TVL</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">7 ngày</dt>
          <dd className={cx('font-semibold tabular-nums', pctClass(candidate.change7dPct))}>{formatPct(candidate.change7dPct, 0)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">30 ngày</dt>
          <dd className={cx('font-semibold tabular-nums', pctClass(candidate.change30dPct))}>{formatPct(candidate.change30dPct, 0)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Audit</dt>
          <dd className="font-semibold tabular-nums text-slate-300">{candidate.audits ?? '—'}</dd>
        </div>
      </dl>

      <ul className="mt-3 space-y-1 text-xs text-emerald-200/90">
        {candidate.reasons.map((r) => (
          <li key={r}>+ {r}</li>
        ))}
      </ul>
      <ul className="mt-2 space-y-1 text-xs text-amber-200/80">
        {candidate.unknowns.map((u) => (
          <li key={u}>? {u}</li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-xs">
        {candidate.url && (
          <a href={candidate.url} target="_blank" rel="noreferrer noopener" className="rounded-md border border-slate-800 px-2.5 py-1.5 text-slate-300 hover:border-slate-700">
            Website
          </a>
        )}
        {candidate.twitter && (
          <a
            href={`https://x.com/${encodeURIComponent(candidate.twitter)}`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-slate-800 px-2.5 py-1.5 text-slate-300 hover:border-slate-700"
          >
            X
          </a>
        )}
        <a
          href={`https://defillama.com/protocol/${encodeURIComponent(candidate.slug)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-md border border-slate-800 px-2.5 py-1.5 text-slate-300 hover:border-slate-700"
        >
          DefiLlama
        </a>
        {farm ? (
          <span className="ml-auto rounded-md bg-emerald-500/10 px-2.5 py-1.5 font-semibold text-emerald-300">Đang farm</span>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="ml-auto rounded-md bg-sky-500/15 px-2.5 py-1.5 font-semibold text-sky-200 hover:bg-sky-500/25 disabled:opacity-50"
          >
            {busy ? 'Đang lưu…' : 'Theo dõi farm'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </article>
  );
}
