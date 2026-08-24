import { RiskBadge } from '@/components/RiskBadge';
import { SafetyBadge } from './SafetyBadge';
import type { Gem } from '@/lib/types';
import { cx, formatPct, formatUsd } from '@/lib/format';

interface GemCardProps {
  gem: Gem;
}

/**
 * One small-cap candidate.
 *
 * Score and risk sit side by side and are never blended: a token can look
 * good on merit and still be dangerous, and that is precisely the case a
 * reader must be able to see. Reasons are shown inline rather than behind a
 * click — the explanation is the product here, not a detail view.
 */
export function GemCard({ gem }: GemCardProps) {
  const priceUp = (gem.priceChange24hPct ?? 0) >= 0;

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold text-slate-100">{gem.symbol}</h3>
            <SafetyBadge verdict={gem.safetyVerdict} />
          </div>
          <p className="truncate text-xs text-slate-500">
            {gem.name} · {gem.chainId} · {gem.dexId}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className="inline-flex items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sm font-semibold tabular-nums text-sky-300"
            title="Gem score: how well this fits the small-cap profile this scanner looks for."
          >
            Gem {gem.gemScore}
          </span>
          <RiskBadge score={gem.riskScore} />
        </div>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-4">
        <Metric label="Liquidity" value={gem.liquidityUsd === null ? '—' : formatUsd(gem.liquidityUsd)} />
        <Metric label="Vol 24h" value={gem.volume24hUsd === null ? '—' : formatUsd(gem.volume24hUsd)} />
        <Metric
          label="24h"
          value={gem.priceChange24hPct === null ? '—' : formatPct(gem.priceChange24hPct, 1)}
          className={priceUp ? 'text-emerald-400' : 'text-rose-400'}
        />
        <Metric label="Age" value={gem.ageDays === null ? '—' : `${Math.floor(gem.ageDays)}d`} />
      </dl>

      <details className="group">
        <summary className="cursor-pointer list-none text-xs font-semibold text-slate-400 hover:text-slate-200">
          <span className="group-open:hidden">Why it was surfaced ▸</span>
          <span className="hidden group-open:inline">Why it was surfaced ▾</span>
        </summary>
        <ol className="mt-2 space-y-1 text-xs text-slate-400">
          {gem.reasons.map((reason, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-slate-600">{i + 1}.</span>
              <span>{reason}</span>
            </li>
          ))}
        </ol>
      </details>

      {gem.url && (
        <a
          href={gem.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-xs font-medium text-sky-400 hover:text-sky-300"
        >
          View chart on DexScreener →
        </a>
      )}
    </article>
  );
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded bg-slate-950/60 px-2 py-1">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className={cx('font-semibold tabular-nums text-slate-200', className)}>{value}</dd>
    </div>
  );
}
