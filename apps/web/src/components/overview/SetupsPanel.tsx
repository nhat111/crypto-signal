import Link from 'next/link';
import type { SetupBtcTrendComparison, SetupCohortComparison, SetupCohortGroup, SetupsResponse, TradeSetup, TrendState } from '@/lib/types';
import { setupLiveRead, setupLiveText, type SetupLiveState } from '@/lib/setupLive';
import { CopyButton } from '@/components/CopyButton';
import { setupAiPrompt } from '@/lib/aiPrompt';
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
const LIVE_TONE: Record<SetupLiveState, string> = {
  ok: 'text-slate-400',
  chased: 'text-amber-300',
  near_stop: 'text-amber-300',
  past_stop: 'text-rose-300',
  past_target: 'text-slate-500',
};

/** `livePrices` is OKX's last price per symbol (/api/coins/live); absent while it loads or when OKX is unreachable. */
export function SetupsPanel({ data, btcTrend, livePrices }: { data: SetupsResponse; btcTrend?: TrendState; livePrices?: Record<string, number> }) {
  const open = data.setups.filter((s) => s.status === 'open');
  const resolved = data.setups.filter((s) => s.status !== 'open').slice(0, 8);
  // The headline counts the setups this panel lists; the baseline cohort
  // has its own line in the comparison below.
  const shown = data.stats.filter((s) => (s.cohort ?? 'core') !== 'scan');
  const totalResolved = shown.reduce((n, s) => n + s.resolved, 0);
  const targets = shown.reduce((n, s) => n + s.targets, 0);
  const rSum = shown.reduce((n, s) => n + (s.avgR ?? 0) * s.resolved, 0);
  const coinSetups = data.stats.some((s) => s.cohort === 'watchlist' || s.cohort === 'scan');

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
                  {s.cohort === 'watchlist' && <WatchlistBadge setup={s} />}
                  {s.exchange === 'okx' && (
                    <span className="ml-1.5 rounded border border-slate-700 px-1 py-px text-[10px] font-medium text-slate-400" title="Nến lấy từ OKX vì Binance đang chặn IP máy chủ">
                      OKX
                    </span>
                  )}
                </h3>
                <span className="text-[11px] text-slate-500">{formatRelativeTime(s.detectedAt)}</span>
              </div>
              <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
                <Cell label="Vào" value={formatUsd(s.entry, false)} />
                <Cell label="Cắt lỗ" value={formatUsd(s.stop, false)} tone="text-rose-300" />
                <Cell label="Chốt lời" value={formatUsd(s.target, false)} tone="text-emerald-300" />
                <Cell label="R:R" value={`1:${s.rr.toFixed(1)}`} />
              </dl>
              <LiveLine setup={s} price={livePrices?.[s.symbol]} />
              <ul className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                {s.reasons.slice(0, -1).map((r) => (
                  <li key={r}>• {r}</li>
                ))}
                {s.btcTrend === 'down' && s.symbol !== 'BTCUSDT' && (
                  <li className="text-amber-300">• Lúc phát hiện, BTC 1D đang giảm — bộ tìm setup không xét BTC.</li>
                )}
              </ul>
              <div className="mt-2 flex flex-wrap gap-x-4">
                <Link href={setupPrefillHref(s)} className="inline-flex min-h-[36px] items-center text-xs font-medium text-sky-300 hover:text-sky-200">
                  Log in journal →
                </Link>
                <CopyButton
                  label="Sao chép cho AI"
                  text={() =>
                    setupAiPrompt(s, {
                      btcTrend,
                      comparison: data.cohortComparison,
                      btcComparison: data.btcTrendComparison,
                      livePrice: livePrices?.[s.symbol],
                      minResolved: data.minResolved,
                      nowMs: Date.now(),
                      origin: window.location.origin,
                    })
                  }
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {coinSetups && data.cohortComparison && <CohortComparison c={data.cohortComparison} minResolved={data.minResolved} />}
      {data.btcTrendComparison && <BtcTrendComparison c={data.btcTrendComparison} minResolved={data.minResolved} />}

      {resolved.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Đã kết thúc</h3>
          <ul className="mt-1 divide-y divide-slate-800/60 text-xs">
            {resolved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span className="text-slate-300">
                  {s.symbol}
                  {s.cohort === 'watchlist' && ' ⭐'} · {KIND[s.kind]} · vào {formatUsd(s.entry, false)}
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

function LiveLine({ setup, price }: { setup: TradeSetup; price: number | undefined }) {
  const read = setupLiveRead(setup, price);
  if (!read) return null;
  return <p className={cx('mt-2 text-[11px] font-medium tabular-nums', LIVE_TONE[read.state])}>{setupLiveText(read)}</p>;
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={cx('tabular-nums font-semibold', tone ?? 'text-slate-200')}>{value}</dd>
    </div>
  );
}

function WatchlistBadge({ setup }: { setup: TradeSetup }) {
  const c = setup.context;
  const title = c
    ? `Trong danh sách theo dõi ngày ${c.scanDay}${c.rs30d === null ? '' : `: ${c.rs30d >= 0 ? '+' : ''}${c.rs30d.toFixed(0)}% so với BTC trong 30 ngày`}`
    : 'Trong danh sách theo dõi';
  return (
    <span className="ml-1.5 rounded border border-amber-500/40 px-1 py-px text-[10px] font-medium text-amber-200" title={title}>
      ⭐ coin mạnh
    </span>
  );
}

function groupText(g: SetupCohortGroup): string {
  if (g.resolved === 0) return 'chưa có setup nào kết thúc';
  return `${g.targets}/${g.resolved} chạm chốt lời${g.avgR === null ? '' : ` · ${g.avgR >= 0 ? '+' : ''}${g.avgR.toFixed(2)}R`}`;
}

const VERDICT: Record<NonNullable<SetupCohortComparison['verdict']>, { text: string; tone: string }> = {
  beats: { text: 'Coin mạnh cho setup tốt hơn thật', tone: 'text-emerald-300' },
  worse: { text: 'Coin mạnh cho setup tệ hơn', tone: 'text-rose-300' },
  indistinguishable: { text: 'Chưa phân biệt được với coin khác', tone: 'text-slate-400' },
};

/**
 * The question the watchlist exists to answer: are setups on strong coins
 * better than the same setups on the other scanned coins? Shown with its
 * sample counts until both sides clear the floor, then with a verdict.
 */
function CohortComparison({ c, minResolved }: { c: SetupCohortComparison; minResolved: number }) {
  const verdict = c.verdict ? VERDICT[c.verdict] : null;
  return (
    <div className="mt-4 rounded-lg border border-slate-800 p-3 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-300">Kiểm chứng: setup trên coin mạnh có tốt hơn không?</h3>
        <span className={cx('font-medium', verdict?.tone ?? 'text-slate-400')}>
          {verdict?.text ?? `Chưa đủ mẫu (cần ${minResolved} setup kết thúc mỗi bên)`}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-1 text-slate-400 sm:grid-cols-2">
        <div>
          <dt className="inline text-slate-300">⭐ Coin mạnh (danh sách theo dõi): </dt>
          <dd className="inline tabular-nums">{groupText(c.watchlist)}</dd>
        </div>
        <div>
          <dt className="inline text-slate-300">Các coin khác trong top: </dt>
          <dd className="inline tabular-nums">{groupText(c.scan)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-500">
        Cùng bộ tìm setup, cùng khoảng thời gian; chỉ coin mạnh được báo Telegram. Đến khi có kết luận, setup ⭐ chỉ để theo dõi.
      </p>
    </div>
  );
}

const BTC_VERDICT: Record<NonNullable<SetupBtcTrendComparison['verdict']>, { text: string; tone: string }> = {
  worse: { text: 'Setup lúc BTC giảm tệ hơn rõ', tone: 'text-rose-300' },
  beats: { text: 'Setup lúc BTC giảm lại tốt hơn', tone: 'text-emerald-300' },
  indistinguishable: { text: 'Chưa thấy khác biệt', tone: 'text-slate-400' },
};

/**
 * Whether to skip a setup while BTC is in a daily downtrend. The card has
 * said "check BTC's trend first" since the start, on intuition; this is
 * what the record says about it, once it has enough to say anything.
 */
function BtcTrendComparison({ c, minResolved }: { c: SetupBtcTrendComparison; minResolved: number }) {
  const verdict = c.verdict ? BTC_VERDICT[c.verdict] : null;
  return (
    <div className="mt-3 rounded-lg border border-slate-800 p-3 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-300">Kiểm chứng: setup lúc BTC 1D giảm có tệ hơn không?</h3>
        <span className={cx('font-medium', verdict?.tone ?? 'text-slate-400')}>
          {verdict?.text ?? `Chưa đủ mẫu (cần ${minResolved} setup kết thúc mỗi bên)`}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-1 text-slate-400 sm:grid-cols-2">
        <div>
          <dt className="inline text-slate-300">BTC 1D giảm: </dt>
          <dd className="inline tabular-nums">{groupText(c.btcDown)}</dd>
        </div>
        <div>
          <dt className="inline text-slate-300">BTC tăng hoặc đi ngang: </dt>
          <dd className="inline tabular-nums">{groupText(c.btcNotDown)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-slate-500">
        Mọi setup trừ của chính BTC, kể cả coin không được báo; tính từ 23/10/2026, khi bắt đầu lưu xu hướng BTC lúc phát hiện.
      </p>
    </div>
  );
}
