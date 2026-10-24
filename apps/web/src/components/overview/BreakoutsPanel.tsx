import type { SpotBreakoutsResponse } from '@/lib/types';
import { BREAKOUT_REPLAY_NOTE, EXIT_LABEL, breakoutRecordLine, pctBelow } from '@/lib/breakouts';
import { formatPct, formatRelativeTime, formatTokenPrice } from '@/lib/format';

const day = (ms: number): string => new Date(ms).toISOString().slice(5, 10).split('-').reverse().join('/');

/**
 * The daily spot breakout list. Paper-tracked: no alert, a replay note
 * always on screen, and an empty list while BTC is not up said as the
 * rule working rather than the tool being idle.
 */
export function BreakoutsPanel({ data }: { data: SpotBreakoutsResponse }) {
  if (!data.enabled) return null;
  const { run, open, closed } = data;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-100">Phá đỉnh 20 ngày (spot)</h2>
        <span className="text-[11px] text-slate-500">{breakoutRecordLine(data)}</span>
      </div>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        Nến ngày đóng trên đỉnh 20 ngày trước, coin trên EMA200, chỉ khi xu hướng dài của BTC tăng (giá và EMA50 trên EMA200 — khác nhãn cấu trúc 1D ở thẻ BTC). Cắt lỗ cố định ở đáy 10 ngày; thoát khi nến ngày đóng dưới
        đường thoát (đáy 10 ngày trước đó, chỉ dời lên). Không có chốt lời cố định.
      </p>
      <p className="mt-2 max-w-2xl rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-200">{BREAKOUT_REPLAY_NOTE}</p>

      {run ? (
        <p className={`mt-2 text-xs ${run.regimeUp ? 'text-emerald-300' : 'text-slate-400'}`}>
          {run.regimeUp
            ? `Xu hướng dài của BTC đang tăng (nến ${day(Date.parse(run.day))}: giá ${formatTokenPrice(run.btcClose)}, EMA50 ${formatTokenPrice(run.btcEma50)}, EMA200 ${formatTokenPrice(run.btcEma200)}) — có tìm ứng viên mới.`
            : `Xu hướng dài của BTC chưa tăng (nến ${day(Date.parse(run.day))}: giá ${formatTokenPrice(run.btcClose)}, EMA50 ${formatTokenPrice(run.btcEma50)}, EMA200 ${formatTokenPrice(run.btcEma200)}) — không vào lệnh mới. Đứng ngoài là một phần của quy tắc.`}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Chưa chạy lần nào — danh sách cập nhật mỗi ngày sau khi nến ngày đóng (7–8h sáng giờ VN).</p>
      )}

      {open.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {open.map((b) => (
            <article key={b.id} className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold text-slate-100">{b.symbol}</h3>
                <span className="text-[11px] text-slate-500">vào nến {day(b.barOpenTime)}</span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <Cell label="Vào" value={formatTokenPrice(b.entry)} />
                <Cell label="Cắt lỗ" value={formatTokenPrice(b.stop)} tone="text-rose-300" hint={`−${pctBelow(b.entry, b.stop).toFixed(1)}%`} />
                <Cell label="Thoát nếu đóng dưới" value={formatTokenPrice(b.trail)} tone="text-amber-300" />
              </dl>
              <p className="mt-2 text-[11px] text-slate-400">
                Phá đỉnh 20 ngày {formatTokenPrice(b.high20)}. Cỡ lệnh: vốn × 1% ÷ {pctBelow(b.entry, b.stop).toFixed(1)}% (đặt lệnh cắt lỗ lên sàn ngay).
              </p>
            </article>
          ))}
        </div>
      )}
      {run && open.length === 0 && <p className="mt-3 text-sm text-slate-500">Không có vị thế nào đang mở.</p>}

      {closed.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Đã kết thúc</h3>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
            {closed.slice(0, 8).map((b) => (
              <li key={b.id}>
                {b.symbol} {day(b.barOpenTime)}→{b.exitTime ? day(b.exitTime) : '?'} · {b.status === 'open' ? '' : EXIT_LABEL[b.status]} ·{' '}
                <span className={(b.rMultiple ?? 0) > 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  {(b.rMultiple ?? 0) >= 0 ? '+' : ''}
                  {(b.rMultiple ?? 0).toFixed(2)}R ({formatPct(b.returnPct, 1)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.fetch?.lastSuccessAt && <p className="mt-2 text-[11px] text-slate-600">Cập nhật {formatRelativeTime(data.fetch.lastSuccessAt)} · nến OKX</p>}
    </section>
  );
}

function Cell({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`font-semibold ${tone ?? 'text-slate-100'}`}>
        {value}
        {hint && <span className="ml-1 text-[10px] font-normal text-slate-500">{hint}</span>}
      </dd>
    </div>
  );
}
