import { cx } from '@/lib/format';
import { SECTOR_LABEL_META, breadthWord, pctTone, signedPct } from '@/lib/narratives';
import type { Sector } from '@/lib/types';

/** One sector against BTC: the median coin, how many coins beat BTC, and who leads. */
export function SectorCard({ sector }: { sector: Sector }) {
  const meta = SECTOR_LABEL_META[sector.label];
  const changed = sector.previousLabel !== null && sector.previousLabel !== sector.label;
  const breadth = breadthWord(sector.breadth7dPct);

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-100">{sector.name}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{sector.coinCount} coin lớn nhất của mảng</p>
        </div>
        <div className="shrink-0 text-right">
          <span title={meta.hint} className={cx('inline-block rounded-md border px-2 py-0.5 text-xs font-semibold', meta.className)}>
            {meta.text}
          </span>
          {changed && sector.previousLabel && (
            <p className="mt-1 text-[11px] text-slate-500">hôm trước: {SECTOR_LABEL_META[sector.previousLabel].text}</p>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">7 ngày</dt>
          <dd className={cx('font-semibold tabular-nums', pctTone(sector.median7dPct))}>{signedPct(sector.median7dPct)}</dd>
          <dd className="tabular-nums text-slate-500">so BTC {signedPct(sector.rs7d)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">30 ngày</dt>
          <dd className={cx('font-semibold tabular-nums', pctTone(sector.median30dPct))}>{signedPct(sector.median30dPct)}</dd>
          <dd className="tabular-nums text-slate-500">so BTC {signedPct(sector.rs30d)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Thắng BTC (7d)</dt>
          <dd className="font-semibold tabular-nums text-slate-200">
            {sector.breadth7dPct.toFixed(0)}% <span className={cx('text-[11px] font-semibold', breadth.className)}>· {breadth.text}</span>
          </dd>
          <dd className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden>
            <div className="h-full rounded-full bg-sky-400/70" style={{ width: `${Math.min(100, Math.max(0, sector.breadth7dPct))}%` }} />
          </dd>
        </div>
      </dl>

      {sector.leaders.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          Dẫn đầu 7 ngày:{' '}
          {sector.leaders.map((l, i) => (
            <span key={l.symbol}>
              {i > 0 && ', '}
              <span className="font-semibold text-slate-200">{l.symbol}</span> <span className={pctTone(l.change7dPct, 0)}>{signedPct(l.change7dPct, 0)}</span>
            </span>
          ))}
        </p>
      )}

      <ul className="mt-2 space-y-1 text-xs text-slate-400">
        {sector.reasons.slice(2).map((r) => (
          <li key={r}>• {r}</li>
        ))}
      </ul>
    </article>
  );
}
