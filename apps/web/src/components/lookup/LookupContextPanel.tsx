import Link from 'next/link';
import { FLOW_META } from '@/lib/coinFlow';
import { cx, formatUsd } from '@/lib/format';
import { SECTOR_LABEL_META, pctTone, signedPct } from '@/lib/narratives';
import type { LookupContext } from '@/lib/types';

const TONE_CLASS: Record<string, string> = {
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  mixed: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  warn: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  bad: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  neutral: 'border-slate-700 bg-slate-800/60 text-slate-300',
};

/**
 * What the app already stored about the coin: who moved it this week
 * (spot or leverage), the sectors it leads and its flywheel. The chart
 * above says where price is; this says whether real money is behind it.
 */
export function LookupContextPanel({ context, base }: { context: LookupContext; base: string }) {
  const c = context.coinScan;
  const meta = c ? FLOW_META[c.flow] : null;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Dòng tiền &amp; bối cảnh</h3>

      {c && meta ? (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('rounded-md border px-2 py-0.5 text-xs font-semibold', TONE_CLASS[meta.tone])}>{meta.label}</span>
            <span className="text-xs text-slate-500">7 ngày, quét {c.day}</span>
          </div>
          <p className="text-xs text-slate-400">{meta.meaning}</p>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Giá 7N / 30N</dt>
              <dd className="tabular-nums">
                <span className={pctTone(c.ret7d)}>{signedPct(c.ret7d)}</span> / <span className={pctTone(c.ret30d)}>{signedPct(c.ret30d)}</span>
              </dd>
            </div>
            {base !== 'BTC' && (
              <div>
                <dt className="text-slate-500">So BTC 7N / 30N</dt>
                <dd className="tabular-nums">
                  <span className={pctTone(c.rs7d)}>{signedPct(c.rs7d)}</span> / <span className={pctTone(c.rs30d)}>{signedPct(c.rs30d)}</span>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-slate-500">OI 7 ngày</dt>
              <dd className={cx('tabular-nums', pctTone(c.oiChange7dPct))}>{signedPct(c.oiChange7dPct)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Funding TB 7 ngày</dt>
              <dd className="tabular-nums text-slate-300">{c.fundingAvg7dPct === null ? '—' : `${c.fundingAvg7dPct.toFixed(4)}%`}</dd>
            </div>
          </dl>
          <ul className="space-y-1 text-xs text-slate-300">
            {c.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
            {c.fundamentals?.bull.map((b) => (
              <li key={b} className="text-emerald-300">▲ {b}</li>
            ))}
            {c.fundamentals?.bear.map((b) => (
              <li key={b} className="text-rose-300">▼ {b}</li>
            ))}
          </ul>
          <Link href="/guide#oi-funding" className="inline-block text-[11px] font-semibold text-sky-300 hover:text-sky-200">
            OI và funding là gì? →
          </Link>
          {[...c.unknowns, ...(c.fundamentals?.unknowns ?? [])].length > 0 && (
            <p className="text-[11px] text-amber-300/80">Không đọc được: {[...c.unknowns, ...(c.fundamentals?.unknowns ?? [])].join(' ')}</p>
          )}
        </div>
      ) : context.coinScanDay ? (
        <p className="text-xs text-slate-400">
          {base} không nằm trong top {context.coinScanSize} coin quét ngày {context.coinScanDay}, nên chưa có dữ liệu spot hay đòn bẩy.{' '}
          <Link href="/coins" className="text-sky-300 hover:text-sky-200">
            Xem các coin được quét →
          </Link>
        </p>
      ) : (
        <p className="text-xs text-slate-500">Chưa có lần quét coin nào.</p>
      )}

      {context.sectors.length > 0 && (
        <p className="mt-3 text-xs text-slate-300">
          <span className="text-slate-500">Dẫn đầu mảng: </span>
          {context.sectors.map((s, i) => (
            <span key={s.categoryId}>
              {i > 0 && ' · '}
              <Link href="/narratives#sectors" className="font-semibold hover:text-sky-200">
                {s.name}
              </Link>{' '}
              (#{s.rank}, {SECTOR_LABEL_META[s.label].text})
            </span>
          ))}
        </p>
      )}

      {context.flywheel && (
        <p className="mt-2 text-xs text-slate-300">
          <span className="text-slate-500">Flywheel: </span>
          {formatUsd(context.flywheel.holdersRevenue30dUsd)} về holder / 30 ngày
          {context.flywheel.holdersRevenueChangePct !== null && (
            <span className={pctTone(context.flywheel.holdersRevenueChangePct, 0)}> · {signedPct(context.flywheel.holdersRevenueChangePct, 0)} so tháng trước</span>
          )}
          {context.flywheel.yieldPct !== null && ` · ${context.flywheel.yieldPct.toFixed(1)}%/năm vốn hoá`}
        </p>
      )}
    </div>
  );
}
