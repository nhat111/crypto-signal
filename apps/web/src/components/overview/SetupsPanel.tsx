import Link from 'next/link';
import type { SetupsResponse, TradeSetup } from '@/lib/types';
import { cx, formatRelativeTime, formatUsd } from '@/lib/format';
import { setupPrefillHref } from '@/lib/journalPrefill';

const KIND: Record<TradeSetup['kind'], string> = { pullback: 'Hồi về hỗ trợ', breakout_retest: 'Phá vùng rồi test lại' };
const STATUS: Record<TradeSetup['status'], { label: string; tone: string }> = {
  open: { label: 'đang mở', tone: 'text-sky-300' },
  target: { label: 'chạm chốt lời', tone: 'text-emerald-400' },
  stop: { label: 'dính cắt lỗ', tone: 'text-rose-400' },
  expired: { label: 'hết hạn', tone: 'text-slate-400' },
};

/**
 * Setups the worker found on closed 4H bars, priced as the guide's plan.
 *
 * Open ones get the full plan and a journal draft; resolved ones are one
 * line each, so the record of how they ended stays on the same screen as
 * the next one being offered. The hit rate is withheld under
 * `minResolved` — the panel's own prominence must not outrun its evidence.
 */
export function SetupsPanel({ data }: { data: SetupsResponse }) {
  const open = data.setups.filter((s) => s.status === 'open');
  const resolved = data.setups.filter((s) => s.status !== 'open').slice(0, 8);
  const totalResolved = data.stats.reduce((n, s) => n + s.resolved, 0);
  const targets = data.stats.reduce((n, s) => n + s.targets, 0);
  const rSum = data.stats.reduce((n, s) => n + (s.avgR ?? 0) * s.resolved, 0);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-100">Setup 4H</h2>
        <span className="text-[11px] text-slate-500">
          {totalResolved === 0
            ? 'chưa có setup nào kết thúc'
            : totalResolved < data.minResolved
              ? `${totalResolved} đã kết thúc — cần ${data.minResolved} mới đáng tin tỉ lệ`
              : `${targets}/${totalResolved} chạm chốt lời · trung bình ${(rSum / totalResolved).toFixed(2)}R`}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        Hồi về hỗ trợ hoặc phá vùng rồi test lại, chỉ khi 1D không giảm và giá trên EMA200, chỉ báo khi R:R từ 1:2.
        Ứng viên, không phải lệnh — tự xem chart và xu hướng BTC trước khi vào.
      </p>

      {open.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Không có setup nào đang mở. Phần lớn thời gian thị trường không có gì để làm — đó là bình thường.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {open.map((s) => (
            <article key={s.id} className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-bold text-slate-100">
                  {s.symbol} <span className="text-xs font-semibold text-sky-300">· {KIND[s.kind]}</span>
                </h3>
                <span className="text-[11px] text-slate-500">{formatRelativeTime(s.detectedAt)}</span>
              </div>
              <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
                <Cell label="Vào" value={formatUsd(s.entry, false)} />
                <Cell label="Cắt lỗ" value={formatUsd(s.stop, false)} tone="text-rose-300" />
                <Cell label="Chốt lời" value={formatUsd(s.target, false)} tone="text-emerald-300" />
                <Cell label="R:R" value={`1:${s.rr.toFixed(1)}`} />
              </dl>
              <ul className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                {s.reasons.slice(0, -1).map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
              <Link href={setupPrefillHref(s)} className="mt-2 inline-flex min-h-[36px] items-center text-xs font-medium text-sky-300 hover:text-sky-200">
                Log in journal →
              </Link>
            </article>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Đã kết thúc</h3>
          <ul className="mt-1 divide-y divide-slate-800/60 text-xs">
            {resolved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span className="text-slate-300">
                  {s.symbol} · {KIND[s.kind]} · vào {formatUsd(s.entry, false)}
                </span>
                <span className={cx('tabular-nums', STATUS[s.status].tone)}>
                  {STATUS[s.status].label}
                  {s.rMultiple !== null && ` (${s.rMultiple >= 0 ? '+' : ''}${s.rMultiple.toFixed(1)}R)`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cx('tabular-nums font-semibold', tone ?? 'text-slate-200')}>{value}</dd>
    </div>
  );
}
