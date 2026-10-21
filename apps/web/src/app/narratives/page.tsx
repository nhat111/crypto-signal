'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { getFlywheel, getSectors } from '@/lib/api';
import { FLYWHEEL_SORTS, SECTOR_LABEL_META, SECTOR_LABEL_ORDER, signedPct, sortFlywheel, type FlywheelSort } from '@/lib/narratives';
import { cx } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';
import type { Sector } from '@/lib/types';
import { SectorCard } from '@/components/narratives/SectorCard';
import { FlywheelCard } from '@/components/narratives/FlywheelCard';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 10 * 60_000;
const FLYWHEEL_PAGE = 30;

function fetchProblem(fetch: { consecutiveFailures: number; lastError: string | null } | null): string | null {
  return fetch && fetch.consecutiveFailures > 0 ? `${fetch.consecutiveFailures} lần lỗi liên tiếp: ${fetch.lastError ?? 'không rõ'}` : null;
}

export default function NarrativesPage() {
  const sectorsFetcher = useCallback(() => getSectors(), []);
  const flywheelFetcher = useCallback(() => getFlywheel(), []);
  const sectors = usePolling(sectorsFetcher, POLL_MS, []);
  const flywheel = usePolling(flywheelFetcher, POLL_MS, []);
  const [sort, setSort] = useState<FlywheelSort>('revenue');
  const [shown, setShown] = useState(FLYWHEEL_PAGE);

  const grouped = useMemo(() => {
    const list = sectors.data?.sectors ?? [];
    return SECTOR_LABEL_ORDER.map((label) => ({ label, items: list.filter((s) => s.label === label) })).filter((g) => g.items.length > 0);
  }, [sectors.data]);
  const flywheelRows = useMemo(() => sortFlywheel(flywheel.data?.rows ?? [], sort), [flywheel.data, sort]);
  const btc: Sector | undefined = sectors.data?.sectors[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Narrative &amp; flywheel</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Thị trường thường chỉ có một hai mảng chạy cùng lúc. Trang này đo mảng nào đang thắng BTC, rộng hay chỉ vài coin
          kéo, và dự án nào đang dùng doanh thu thật để mua lại, đốt hoặc chia cho người giữ token. Cập nhật mỗi ngày.
          Mô tả dòng tiền, không phải lời khuyên mua bán.
        </p>
        <Link href="/guide/narrative" className="mt-2 inline-block text-xs font-semibold text-sky-300 hover:text-sky-200">
          Cách đọc trang này →
        </Link>
        <nav className="mt-3 flex gap-2 text-xs">
          <a href="#sectors" className="rounded-md border border-slate-800 px-2.5 py-1.5 text-slate-300 hover:border-slate-700">
            Dòng tiền theo mảng
          </a>
          <a href="#flywheel" className="rounded-md border border-slate-800 px-2.5 py-1.5 text-slate-300 hover:border-slate-700">
            Flywheel
          </a>
        </nav>
      </div>

      <section id="sectors" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-200">Dòng tiền theo mảng</h2>
          <p className="mt-1 text-xs text-slate-500">
            Mỗi mảng: 30 coin vốn hoá lớn nhất trên CoinGecko (bỏ stablecoin). Số là của <b>coin trung vị</b>, để một coin lớn không
            nói thay cả mảng.
            {btc && (
              <>
                {' '}
                BTC: <span className="tabular-nums text-slate-300">{signedPct(btc.btc7dPct)}</span> 7 ngày,{' '}
                <span className="tabular-nums text-slate-300">{signedPct(btc.btc30dPct)}</span> 30 ngày · dữ liệu ngày {sectors.data?.day}.
              </>
            )}
          </p>
          {fetchProblem(sectors.data?.fetch ?? null) && <p className="mt-1 text-xs text-amber-300">{fetchProblem(sectors.data?.fetch ?? null)}</p>}
        </div>

        {sectors.loading && !sectors.data ? (
          <LoadingPanel label="Đang tải…" />
        ) : sectors.error && !sectors.data ? (
          <StatePanel tone="error" title="Không gọi được API" detail={sectors.error} />
        ) : sectors.data && !sectors.data.enabled ? (
          <StatePanel title="Đang tắt" detail="Worker đặt SECTOR_SCAN=off." />
        ) : grouped.length === 0 ? (
          <StatePanel title="Chưa có dữ liệu" detail="Worker tính lần đầu khoảng 15 phút sau khi khởi động, sau đó mỗi ngày một lần." />
        ) : (
          grouped.map((g) => (
            <div key={g.label} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {SECTOR_LABEL_META[g.label].text} <span className="normal-case tracking-normal text-slate-600">· {SECTOR_LABEL_META[g.label].hint}</span>
              </h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.items.map((s) => (
                  <SectorCard key={s.categoryId} sector={s} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section id="flywheel" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-200">Flywheel: doanh thu quay về holder</h2>
          <p className="mt-1 text-xs text-slate-500">
            Theo DefiLlama (holders revenue): tiền dự án hoặc chain trả lại cho người giữ token qua buyback, burn hoặc chia phí trong
            30 ngày. “%/năm vốn hoá” = 30 ngày × 12 chia vốn hoá hiện tại, giống tỉ suất cổ tức; trên 50% thường là khoản trả một lần.
            {flywheel.data?.day && ` Dữ liệu ngày ${flywheel.data.day}.`}
          </p>
          {fetchProblem(flywheel.data?.fetch ?? null) && <p className="mt-1 text-xs text-amber-300">{fetchProblem(flywheel.data?.fetch ?? null)}</p>}
        </div>

        <div className="flex flex-wrap gap-1">
          {FLYWHEEL_SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={cx(
                'inline-flex min-h-[32px] items-center rounded-md px-3 text-xs font-semibold transition-colors',
                s.id === sort ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {flywheel.loading && !flywheel.data ? (
          <LoadingPanel label="Đang tải…" />
        ) : flywheel.error && !flywheel.data ? (
          <StatePanel tone="error" title="Không gọi được API" detail={flywheel.error} />
        ) : flywheel.data && !flywheel.data.enabled ? (
          <StatePanel title="Đang tắt" detail="Worker đặt FLYWHEEL_SCAN=off." />
        ) : flywheelRows.length === 0 ? (
          <StatePanel title="Chưa có dữ liệu" detail="Worker tính lần đầu khoảng 10 phút sau khi khởi động, sau đó mỗi ngày một lần." />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {flywheelRows.slice(0, shown).map((r) => (
                <FlywheelCard key={r.familyKey} row={r} />
              ))}
            </div>
            {shown < flywheelRows.length && (
              <button
                type="button"
                onClick={() => setShown((n) => n + FLYWHEEL_PAGE)}
                className="w-full rounded-md border border-slate-800 py-2 text-xs font-semibold text-slate-300 hover:border-slate-700"
              >
                Xem thêm ({flywheelRows.length - shown})
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
