import Link from 'next/link';
import { HealthBadge } from '@/components/HealthBadge';
import { RiskBadge } from '@/components/RiskBadge';
import { StatePanel } from '@/components/StatePanel';
import type { OverviewRow, Signal, SymbolLatest } from '@/lib/types';
import { cx, formatPct, formatRelativeTime, formatSignedUsd, formatUsd, isStale } from '@/lib/format';

interface SymbolCardProps {
  symbol: string;
  overviewRow: OverviewRow | undefined;
  snapshot: SymbolLatest | null | undefined;
  activeSignalCount: number;
  latestSignal: Signal | undefined;
}

/**
 * Market Overview card (spec §17): health, risk, active signals, price, and
 * the four demand/leverage metrics side by side so a rally can be sanity
 * checked in one glance.
 */
export function SymbolCard({ symbol, overviewRow, snapshot, activeSignalCount, latestSignal }: SymbolCardProps) {
  if (!overviewRow) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-100">{symbol}</h3>
        </div>
        <StatePanel title="Waiting for data" detail="No health snapshot yet for this symbol." />
      </div>
    );
  }

  const priceUp = overviewRow.priceChangePct >= 0;
  // Judged against this row's own frame: a 4h snapshot is legitimately
  // hours old, and a flat threshold would brand every card stale.
  const stale = isStale(overviewRow.timestamp, overviewRow.timeframe);

  return (
    <Link
      href={`/symbol/${symbol}`}
      className="block rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition-colors hover:border-slate-700 hover:bg-slate-900/70"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-100">{symbol}</h3>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold tabular-nums text-slate-100">
              {formatUsd(overviewRow.priceClose, false)}
            </span>
            <span className={cx('text-xs font-semibold tabular-nums', priceUp ? 'text-emerald-400' : 'text-rose-400')}>
              {formatPct(overviewRow.priceChangePct)}
            </span>
          </div>
        </div>
        {activeSignalCount > 0 && (
          <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-xs font-bold text-sky-300">
            {activeSignalCount} signal{activeSignalCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <HealthBadge score={overviewRow.healthScore} status={overviewRow.healthStatus} />
        <RiskBadge score={overviewRow.riskScore} />
        {/* A health score without its timeframe is not a number, it is two
            numbers wearing one label: the same symbol scores differently on
            5m and 4h. The frame is now the reader's choice, which makes
            labelling it more necessary rather than less. */}
        <span className="rounded border border-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          khung {overviewRow.timeframe}
        </span>
      </div>

      {/* A stopped stream is invisible on a card that only shows values:
          every figure below stays exactly as legible as a live one. The
          threshold matches /status so the two pages cannot disagree about
          which symbols are keeping up. */}
      {stale && (
        <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/[0.08] px-2 py-1.5 text-[11px] font-semibold leading-relaxed text-amber-300">
          Dữ liệu cũ — cập nhật lần cuối {formatRelativeTime(overviewRow.timestamp)}. Mọi số bên dưới là của lúc đó,
          không phải bây giờ.
        </p>
      )}

      {/* A null health score has exactly one cause — computeHealthComponents
          returns null when a snapshot has no spot leg — so the reason can be
          stated rather than left as a bare "N/A". Without this the badge
          reads as a fault in the collector, which is what it was taken for. */}
      {overviewRow.healthScore === null && (
        <p className="mb-3 rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-[11px] leading-relaxed text-slate-500">
          No Binance spot listing, so Health Score cannot exist — it measures spot against futures. Risk Score is
          unaffected.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <Metric label="Spot CVD" value={snapshot?.spotCvd != null ? formatSignedUsd(snapshot.spotCvd) : '—'} />
        <Metric label="Futures CVD" value={snapshot ? formatSignedUsd(snapshot.futuresCvd) : '—'} />
        <Metric label="Open Interest" value={snapshot ? formatUsd(snapshot.openInterest) : '—'} />
        <Metric label="Funding" value={snapshot ? formatPct(snapshot.fundingRatePct, 3) : '—'} />
        <Metric label="Liq. Long" value={snapshot ? formatUsd(snapshot.liquidationLongUsd) : '—'} tone="rose" />
        <Metric label="Liq. Short" value={snapshot ? formatUsd(snapshot.liquidationShortUsd) : '—'} tone="emerald" />
      </dl>

      {latestSignal && (
        <p className="mt-3 truncate border-t border-slate-800 pt-2 text-[11px] text-slate-500">
          Latest: <span className="text-slate-300">{latestSignal.signalType.replace(/_/g, ' ')}</span>
        </p>
      )}
    </Link>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'emerald' }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-slate-950/60 px-2 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={cx(
          'font-semibold tabular-nums',
          tone === 'rose' ? 'text-rose-400' : tone === 'emerald' ? 'text-emerald-400' : 'text-slate-200',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
