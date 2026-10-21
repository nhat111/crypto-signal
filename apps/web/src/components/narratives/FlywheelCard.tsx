import { cx, formatUsd } from '@/lib/format';
import { pctTone, signedPct } from '@/lib/narratives';
import type { FlywheelRow } from '@/lib/types';

/** One protocol or chain whose revenue goes back to its token holders. */
export function FlywheelCard({ row }: { row: FlywheelRow }) {
  return (
    <article className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-100">
            {row.name}
            {row.symbol && <span className="ml-1.5 text-xs font-semibold text-slate-400">{row.symbol}</span>}
          </h3>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {row.category ?? 'Không rõ mảng'}
            {row.sources.length > 1 && ` · ${row.sources.length} sản phẩm`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-100">{formatUsd(row.holdersRevenue30dUsd)}</p>
          <p className="text-[11px] text-slate-500">về holder / 30 ngày</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">So tháng trước</dt>
          <dd
            className={cx('font-semibold tabular-nums', pctTone(row.holdersRevenueChangePct, 0))}
          >
            {signedPct(row.holdersRevenueChangePct, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">%/năm vốn hoá</dt>
          <dd className={cx('font-semibold tabular-nums', row.yieldPct !== null && row.yieldPct > 50 ? 'text-amber-300' : 'text-slate-200')}>
            {row.yieldPct === null ? '—' : `${row.yieldPct.toFixed(1)}%`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Giá 30 ngày</dt>
          <dd
            className={cx('font-semibold tabular-nums', pctTone(row.priceChange30dPct, 0))}
          >
            {signedPct(row.priceChange30dPct, 0)}
          </dd>
        </div>
      </dl>

      <ul className="mt-3 space-y-1 text-xs text-emerald-200/90">
        {row.reasons.slice(1).map((r) => (
          <li key={r}>+ {r}</li>
        ))}
      </ul>
      <ul className="mt-1 space-y-1 text-xs text-amber-200/80">
        {row.unknowns.map((u) => (
          <li key={u}>? {u}</li>
        ))}
      </ul>
      {row.mechanism && (
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer">Cơ chế (theo DefiLlama)</summary>
          <p className="mt-1 text-slate-400">{row.mechanism}</p>
        </details>
      )}
      {row.geckoId && (
        <a
          href={`https://www.coingecko.com/en/coins/${encodeURIComponent(row.geckoId)}`}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-auto self-start pt-3 text-xs text-sky-300 hover:text-sky-200"
        >
          CoinGecko →
        </a>
      )}
    </article>
  );
}
