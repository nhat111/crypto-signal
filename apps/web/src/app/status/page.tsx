'use client';

import { useCallback, useState } from 'react';
import { getOutcomeDiagnostics, getStatus } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import type {
  StatusJob,
  StatusOutcomeDiagnostics,
  StatusOutcomeHorizon,
  StatusResponse,
  StatusService,
  StatusWorkerRuntime,
} from '@/lib/types';
import { ago, Row, StatusCard } from '@/components/status/StatusBlocks';
import {
  collectorVerdict,
  isHorizonStuck,
  isJobBroken,
  isJobFailing,
  jobsVerdict,
  outcomesVerdict,
  symbolVerdict,
  diagnoseFromCensus,
  DIAGNOSIS_TEXT,
  workerVerdict,
  connectionVerdict,
  isHeartbeatStale,
  diagnoseIngest,
  INGEST_TEXT,
  versionVerdict,
  FAILURE_STREAK_WORTH_SHOWING,
  STALE_SNAPSHOT_MS,
} from '@/lib/statusVerdicts';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 30_000;

export default function StatusPage() {
  const fetcher = useCallback(() => getStatus(), []);
  const status = usePolling(fetcher, POLL_MS, []);
  const isBootstrapping = status.loading && !status.data;

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-16">
      <header>
        <h1 className="text-lg font-bold text-slate-100">System status</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
          Kiểm tra deploy đã lên chưa và có gì đang hỏng âm thầm không — không cần terminal. Trang tự làm mới mỗi
          30 giây.
        </p>
      </header>

      {isBootstrapping ? (
        <LoadingPanel label="Đang đọc trạng thái…" />
      ) : status.error && !status.data ? (
        <StatePanel tone="error" title="Không gọi được API" detail={status.error} />
      ) : status.data ? (
        <StatusBody data={status.data} />
      ) : null}
    </div>
  );
}

function StatusBody({ data }: { data: StatusResponse }) {
  return (
    <div className="space-y-3">
      <BuildCard data={data} />
      <WorkerCard worker={data.worker} />
      <CollectorCard data={data} />
      <OutcomesCard outcomes={data.outcomes} />
      <JobsCard jobs={data.jobs} />
    </div>
  );
}

/* ---------------- build ---------------- */

function BuildCard({ data }: { data: StatusResponse }) {
  const { version } = data;
  const verdict = versionVerdict(version);

  return (
    <StatusCard
      title="Bản đang chạy"
      verdict={verdict}
      headline={version.commit ?? 'không rõ commit'}
    >
      <Row label="Commit" value={version.commit ?? '— (chưa set biến môi trường)'} />
      {version.commitSource && <Row label="Đọc từ biến" value={version.commitSource} />}
      <Row label="Khởi động" value={ago(version.uptimeMs)} />
      <Row label="Migration mới nhất" value={version.schema.latest ?? '—'} />

      {/* Services are deployed one at a time here, so "which build is the
          api on" is only half the answer. Each one that has no HTTP surface
          writes its build at boot; a missing row means it has not started
          since this was added. */}
      {data.services.map((svc: StatusService) => (
        <Row
          key={svc.service}
          label={`${svc.service} — commit`}
          value={`${svc.commit ?? '—'} · khởi động ${ago(Date.now() - svc.startedAt)}`}
        />
      ))}
      {data.services.length === 0 && (
        <Row label="worker — commit" value="chưa báo cáo (worker chưa khởi động lại)" tone="warn" />
      )}
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        Dòng <span className="font-semibold text-slate-400">Commit</span> đầu là của api. Mỗi service khác tự
        báo bản của nó khi khởi động. Cái nào còn hiện commit cũ → service đó chưa deploy lại.
      </p>
    </StatusCard>
  );
}

/* ---------------- worker ---------------- */

const CONNECTION_LABEL: Record<string, string> = {
  spot: 'Sàn thường (spot)',
  futures: 'Sàn đòn bẩy (futures)',
  liquidation: 'Thanh lý',
};

const STATE_TEXT: Record<string, string> = {
  open: 'đang mở',
  connecting: 'đang kết nối',
  closed: 'đã đóng',
  error: 'lỗi',
};

/**
 * Whether each Binance socket is actually open.
 *
 * The collector card below says a symbol has gone quiet; this one says
 * whether the connection feeding it is alive. Those are different
 * failures with different fixes — a dead socket is a reconnect problem, an
 * open socket with a quiet symbol is a bug in the pipeline behind it — and
 * without this the operator could only guess between them.
 */
function WorkerCard({ worker }: { worker: StatusWorkerRuntime | null }) {
  const verdict = workerVerdict(worker);
  const stale = worker !== null && isHeartbeatStale(worker);

  const headline =
    worker === null
      ? 'chưa báo cáo'
      : stale
        ? `nhịp tim ngừng ${ago(worker.ageMs)}`
        : Object.values(worker.connections).every((s) => s === 'open')
          ? 'mọi kết nối đang mở'
          : 'có kết nối không mở';

  return (
    <StatusCard title="Kết nối Binance" verdict={verdict} headline={headline}>
      {worker === null ? (
        <p className="text-xs text-slate-500">
          Worker chưa gửi nhịp tim nào. Bình thường nếu nó vừa deploy hoặc chưa chạy bản có tính năng này — kiểm lại
          sau vài phút.
        </p>
      ) : (
        <>
          <Row label="Nhịp tim gần nhất" value={ago(worker.ageMs)} tone={stale ? 'bad' : 'ok'} />
          {(['spot', 'futures', 'liquidation'] as const).map((key) => (
            <Row
              key={key}
              label={CONNECTION_LABEL[key] ?? key}
              // A stale row's socket states describe a process that may not
              // exist any more. Showing them as fact would be inventing an
              // observation — the exact thing this page must never do.
              value={stale ? 'không rõ (nhịp tim đã cũ)' : (STATE_TEXT[worker.connections[key]] ?? worker.connections[key])}
              tone={connectionVerdict(worker.connections[key], stale)}
            />
          ))}
        </>
      )}
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        Kết nối <span className="font-semibold text-slate-400">đang mở</span> mà symbol vẫn đứng ở thẻ dưới → lỗi nằm
        ở phần xử lý, không phải đường truyền. Kết nối <span className="font-semibold text-slate-400">đã đóng</span>{' '}
        → mất kết nối tới Binance.
      </p>
    </StatusCard>
  );
}

/* ---------------- collector ---------------- */

function CollectorCard({ data }: { data: StatusResponse }) {
  const rows = data.collector;
  const now = data.serverTime;
  const noData = rows.filter((r) => r.lastSnapshotAt === null).length;
  const stale = rows.filter((r) => r.ageMs !== null && r.ageMs > STALE_SNAPSHOT_MS).length;

  const verdict = collectorVerdict(rows);
  const headline =
    rows.length === 0
      ? 'chưa có symbol nào'
      : stale + noData === 0
        ? `${rows.length} symbol đều tươi`
        : `${stale + noData}/${rows.length} symbol có vấn đề`;

  return (
    <StatusCard title="Thu thập dữ liệu" verdict={verdict} headline={headline}>
      {rows.map((r) => {
        // Two clocks, deliberately. The snapshot time needs the whole
        // pipeline to have worked; the ingest time is stamped the moment a
        // candle arrives. A gap between them says which half is broken.
        const verdict = diagnoseIngest(r.lastSnapshotAt, data.worker?.symbolIngest[r.symbol], now);
        return (
          <div key={r.symbol}>
            <Row
              label={r.symbol}
              value={r.lastSnapshotAt === null ? 'chưa có dữ liệu' : ago(r.ageMs)}
              tone={symbolVerdict(r)}
            />
            {verdict !== 'flowing' && (
              <p className="-mt-0.5 pb-1.5 text-right text-[11px] leading-relaxed text-amber-300/80">
                {INGEST_TEXT[verdict]}
              </p>
            )}
          </div>
        );
      })}
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        Mỗi symbol phải có dữ liệu mới trong vòng 15 phút. Dòng chữ vàng bên dưới một symbol cho biết hỏng ở đâu:{' '}
        <span className="font-semibold text-slate-400">phía kết nối</span> (nến không tới) hay{' '}
        <span className="font-semibold text-slate-400">phần xử lý</span> (nến tới mà không ra kết quả).
      </p>
    </StatusCard>
  );
}

/* ---------------- outcomes ---------------- */

/**
 * The one number worth reading here is `resolvableNow` against `pending`.
 * A backlog being worked through and a backlog that can never be priced
 * both look like "lots pending"; only the resolvable count separates them,
 * and the second one is the failure that used to go unnoticed for weeks.
 */
function OutcomesCard({ outcomes }: { outcomes: StatusOutcomeHorizon[] }) {
  const stuck = outcomes.filter(isHorizonStuck);
  const anyPending = outcomes.some((o) => o.pending > 0);

  const verdict = outcomesVerdict(outcomes);
  const headline =
    stuck.length > 0
      ? `${stuck.length} khung đang tắc`
      : anyPending
        ? 'đang xử lý bình thường'
        : 'không còn gì chờ';

  return (
    <StatusCard title="Chấm kết quả tín hiệu" verdict={verdict} headline={headline}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-500">
              <th className="border-b border-slate-800 py-1.5 text-left font-semibold">Khung</th>
              <th className="hidden border-b border-slate-800 py-1.5 text-right font-semibold sm:table-cell">Đã chấm</th>
              <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Đang chờ</th>
              <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Chấm được ngay</th>
              <th className="hidden border-b border-slate-800 py-1.5 text-right font-semibold sm:table-cell">Cũ nhất</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => {
              const isStuck = isHorizonStuck(o);
              return (
                <tr key={o.horizon} className="tabular-nums">
                  <td className="border-b border-slate-800/60 py-1.5 font-medium text-slate-300">{o.horizon}</td>
                  <td className="hidden border-b border-slate-800/60 py-1.5 text-right text-slate-200 sm:table-cell">{o.resolved}</td>
                  <td className="border-b border-slate-800/60 py-1.5 text-right text-slate-400">{o.pending}</td>
                  <td
                    className={`border-b border-slate-800/60 py-1.5 text-right font-semibold ${
                      isStuck ? 'text-amber-300' : 'text-slate-400'
                    }`}
                  >
                    {o.resolvableNow}
                  </td>
                  <td className="hidden border-b border-slate-800/60 py-1.5 text-right text-slate-500 sm:table-cell">
                    {o.oldestPendingAt === null ? '—' : ago(Date.now() - o.oldestPendingAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        <span className="font-semibold text-slate-400">Đang chờ</span> lớn mà{' '}
        <span className="font-semibold text-slate-400">Chấm được ngay</span> bằng 0 → mấy tín hiệu đó không có nến
        5m để chấm, đợi thêm cũng không giải quyết được.
      </p>
      {stuck.length > 0 && <StuckDiagnostics outcomes={outcomes} />}
    </StatusCard>
  );
}

/**
 * The "why" behind a stuck backlog, fetched only when asked.
 *
 * /api/status is polled every 30 seconds; these two queries are scans and
 * their answer changes on the scale of a backfill, not of a poll. The
 * alternative to this panel was a psql session, which on this platform
 * means a laptop — and the operator is on a phone, which is exactly where
 * a silent failure gets to stay silent.
 */
function StuckDiagnostics({ outcomes }: { outcomes: StatusOutcomeHorizon[] }) {
  const [data, setData] = useState<StatusOutcomeDiagnostics | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string>('');

  const load = useCallback(() => {
    setState('loading');
    getOutcomeDiagnostics()
      .then((res) => {
        setData(res);
        setState('idle');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });
  }, []);

  if (data === null) {
    return (
      <div className="mt-3 border-t border-slate-800 pt-3">
        <button
          type="button"
          onClick={load}
          disabled={state === 'loading'}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100 disabled:opacity-50"
        >
          {state === 'loading' ? 'Đang kiểm tra…' : 'Vì sao chưa chấm được?'}
        </button>
        {state === 'error' && <p className="mt-2 text-xs text-rose-300">{error}</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Quét toàn bộ kho nến nên chỉ chạy khi bấm, không chạy theo nhịp tự làm mới 30 giây.
        </p>
      </div>
    );
  }

  // The first horizon that actually has stuck rows, paired with its own
  // resolvable count — diagnosing 15m when only 24h is backed up would
  // answer a question nobody asked.
  // The horizon with the largest backlog, not the first with any rows: the
  // point is to explain the bulk of the problem, not its oldest corner.
  const worst = [...data.census].sort((a, b) => b.pending - a.pending)[0];
  const horizon = worst?.horizon ?? '15m';
  const rows = data.stuck.find((h) => h.horizon === horizon)?.rows ?? [];
  const resolvableNow = outcomes.find((o) => o.horizon === horizon)?.resolvableNow ?? 0;
  const verdict = DIAGNOSIS_TEXT[
    worst ? diagnoseFromCensus(worst, resolvableNow) : 'clear'
  ];

  const tone =
    verdict.tone === 'bad'
      ? 'border-rose-500/25 bg-rose-500/[0.07]'
      : verdict.tone === 'warn'
        ? 'border-amber-500/25 bg-amber-500/[0.07]'
        : 'border-emerald-500/25 bg-emerald-500/[0.07]';
  const toneText =
    verdict.tone === 'bad' ? 'text-rose-300' : verdict.tone === 'warn' ? 'text-amber-300' : 'text-emerald-300';

  return (
    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
      <div className={`rounded-lg border px-3.5 py-3 ${tone}`}>
        <p className={`text-xs font-bold uppercase tracking-wide ${toneText}`}>Kết luận · khung {horizon}</p>
        <p className="mt-1.5 text-sm font-semibold text-slate-100">{verdict.headline}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{verdict.detail}</p>
      </div>

      {worst && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Đếm toàn bộ hàng đợi · khung {worst.horizon}
          </p>
          <div className="mt-1.5 space-y-0">
            <Row label="Tổng đang chờ" value={String(worst.pending)} />
            <Row
              label="Có nến, đáng lẽ chấm được"
              value={String(worst.withCandles)}
              tone={worst.withCandles > 0 && resolvableNow === 0 ? 'bad' : 'ok'}
            />
            <Row label="Ra đời trước mọi cây nến" value={String(worst.predateCandles)} tone="idle" />
            <Row
              label="Nằm trong khoảng có nến nhưng thiếu nến"
              value={String(worst.insideCoverageNoCandle)}
              tone={worst.insideCoverageNoCandle > 0 ? 'warn' : 'ok'}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Đây là <span className="font-semibold text-slate-400">đếm hết</span>, không phải suy từ vài dòng cũ nhất
            — nên một nhúm tín hiệu cổ không kéo được kết luận đi sai nữa.
          </p>
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nến 5m futures đang có</p>
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                <th className="border-b border-slate-800 py-1.5 text-left font-semibold">Symbol</th>
                <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Số nến</th>
                <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Cũ nhất</th>
                <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Mới nhất</th>
              </tr>
            </thead>
            <tbody>
              {data.pricingCandles.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-2 text-xs text-rose-300">
                    Không có cây nến 5m futures nào.
                  </td>
                </tr>
              ) : (
                data.pricingCandles.map((c) => (
                  <tr key={c.symbol} className="tabular-nums">
                    <td className="border-b border-slate-800/60 py-1.5 font-medium text-slate-300">{c.symbol}</td>
                    <td className="border-b border-slate-800/60 py-1.5 text-right text-slate-200">{c.candles}</td>
                    <td className="border-b border-slate-800/60 py-1.5 text-right text-slate-500">
                      {c.earliestAt === null ? '—' : ago(Date.now() - c.earliestAt)}
                    </td>
                    <td className="border-b border-slate-800/60 py-1.5 text-right text-slate-500">
                      {c.latestAt === null ? '—' : ago(Date.now() - c.latestAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Tín hiệu cũ nhất chưa chấm được
        </p>
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                <th className="border-b border-slate-800 py-1.5 text-left font-semibold">Symbol</th>
                <th className="border-b border-slate-800 py-1.5 text-left font-semibold">Lúc</th>
                <th className="border-b border-slate-800 py-1.5 text-left font-semibold">Nguồn</th>
                <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Nến trong cửa sổ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.symbol}-${row.timestamp}-${i}`} className="tabular-nums">
                  <td className="border-b border-slate-800/60 py-1.5 font-medium text-slate-300">{row.symbol}</td>
                  <td className="border-b border-slate-800/60 py-1.5 text-slate-400">
                    {ago(Date.now() - row.timestamp)}
                  </td>
                  <td className="border-b border-slate-800/60 py-1.5 text-slate-500">{row.source}</td>
                  <td
                    className={`border-b border-slate-800/60 py-1.5 text-right font-semibold ${
                      row.candlesInWindow === 0 ? 'text-amber-300' : 'text-slate-400'
                    }`}
                  >
                    {row.candlesInWindow}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          <span className="font-semibold text-slate-400">Nến trong cửa sổ</span> đếm đúng khoảng mà bộ chấm đi tìm.
          Bằng 0 nghĩa là chờ thêm bao lâu cũng không chấm được.
        </p>
      </div>
    </div>
  );
}

/* ---------------- jobs ---------------- */

function JobsCard({ jobs }: { jobs: StatusJob[] }) {
  const broken = jobs.filter(isJobBroken);
  const failing = jobs.filter(isJobFailing);

  const verdict = jobsVerdict(jobs);
  const headline =
    jobs.length === 0
      ? 'chưa job nào chạy'
      : broken.length > 0
        ? `${broken.length} job hỏng hẳn`
        : failing.length > 0
          ? `${failing.length} job đang lỗi`
          : 'tất cả bình thường';

  return (
    <StatusCard title="Tác vụ nền" verdict={verdict} headline={headline}>
      {jobs.length === 0 ? (
        <p className="text-xs text-slate-500">
          Chưa job nào ghi lại lần chạy. Bình thường nếu worker vừa deploy — kiểm lại sau vài phút.
        </p>
      ) : (
        jobs.map((j) => {
          const isBroken = isJobBroken(j);
          const isFailing = isJobFailing(j);
          return (
            <div key={j.jobName} className="border-b border-slate-800/60 py-2 last:border-b-0">
              <Row
                label={j.jobName}
                value={
                  isBroken
                    ? `hỏng — ${j.consecutiveFailures} lần, chưa lần nào chạy được`
                    : isFailing
                      ? `lỗi ${j.consecutiveFailures} lần liên tiếp`
                      : `chạy được ${ago(j.lastSuccessAt === null ? null : Date.now() - j.lastSuccessAt)}`
                }
                tone={isBroken ? 'bad' : isFailing ? 'warn' : 'ok'}
              />
              {j.lastError && (isBroken || isFailing) && (
                <p className="mt-1 break-words font-mono text-[11px] text-rose-300/70">{j.lastError}</p>
              )}
            </div>
          );
        })
      )}
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        <span className="font-semibold text-rose-300">Hỏng hẳn</span> = chạy nhiều lần nhưng chưa lần nào thành
        công. Đây không phải &ldquo;chưa tới lượt&rdquo; — cần sửa.
      </p>
    </StatusCard>
  );
}
