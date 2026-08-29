'use client';

import { useCallback } from 'react';
import { getStatus } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import type { StatusJob, StatusOutcomeHorizon, StatusResponse } from '@/lib/types';
import { ago, Row, StatusCard } from '@/components/status/StatusBlocks';
import {
  collectorVerdict,
  isHorizonStuck,
  isJobBroken,
  isJobFailing,
  jobsVerdict,
  outcomesVerdict,
  symbolVerdict,
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
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        So <span className="font-semibold text-slate-400">Commit</span> với commit vừa push. Còn hiện bản cũ, hoặc{' '}
        <span className="font-semibold text-slate-400">Khởi động</span> là nhiều giờ trước dù vừa bấm redeploy →
        deploy chưa lên.
      </p>
    </StatusCard>
  );
}

/* ---------------- collector ---------------- */

function CollectorCard({ data }: { data: StatusResponse }) {
  const rows = data.collector;
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
      {rows.map((r) => (
        <Row
          key={r.symbol}
          label={r.symbol}
          value={r.lastSnapshotAt === null ? 'chưa có dữ liệu' : ago(r.ageMs)}
          tone={symbolVerdict(r)}
        />
      ))}
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        Mỗi symbol phải có dữ liệu mới trong vòng 15 phút. Cũ hơn nghĩa là worker chết hoặc mất kết nối Binance.
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
        <table className="w-full min-w-[26rem] border-collapse text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-500">
              <th className="border-b border-slate-800 py-1.5 text-left font-semibold">Khung</th>
              <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Đã chấm</th>
              <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Đang chờ</th>
              <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Chấm được ngay</th>
              <th className="border-b border-slate-800 py-1.5 text-right font-semibold">Cũ nhất</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => {
              const isStuck = isHorizonStuck(o);
              return (
                <tr key={o.horizon} className="tabular-nums">
                  <td className="border-b border-slate-800/60 py-1.5 font-medium text-slate-300">{o.horizon}</td>
                  <td className="border-b border-slate-800/60 py-1.5 text-right text-slate-200">{o.resolved}</td>
                  <td className="border-b border-slate-800/60 py-1.5 text-right text-slate-400">{o.pending}</td>
                  <td
                    className={`border-b border-slate-800/60 py-1.5 text-right font-semibold ${
                      isStuck ? 'text-amber-300' : 'text-slate-400'
                    }`}
                  >
                    {o.resolvableNow}
                  </td>
                  <td className="border-b border-slate-800/60 py-1.5 text-right text-slate-500">
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
        <span className="font-semibold text-slate-400">Chấm được ngay</span> bằng 0 → mấy tín hiệu đó thiếu nến 5m
        để chấm, đợi thêm cũng không giải quyết được. Thường do backfill chạy thiếu khung 5m.
      </p>
    </StatusCard>
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
