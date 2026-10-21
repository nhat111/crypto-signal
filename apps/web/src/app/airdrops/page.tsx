'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { getAirdrops, getFarms, startFarm } from '@/lib/api';
import { AIRDROP_SORTS, activeFarmFor, filterCandidates, formatAgoVi, sortCandidates, type AirdropSort } from '@/lib/airdrop';
import { usePolling } from '@/lib/usePolling';
import { cx } from '@/lib/format';
import type { AirdropCandidate } from '@/lib/types';
import { CandidateCard } from '@/components/airdrop/CandidateCard';
import { FarmPanel } from '@/components/airdrop/FarmPanel';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 5 * 60_000;
const FARM_POLL_MS = 30_000;
const PAGE_SIZE = 40;

export default function AirdropsPage() {
  const [sort, setSort] = useState<AirdropSort>('tvl');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);

  const listFetcher = useCallback(() => getAirdrops(), []);
  const list = usePolling(listFetcher, POLL_MS, []);
  // Its own poll and its own failure: an API without the farm routes must
  // not take the research list down with it.
  const farmsFetcher = useCallback(() => getFarms(), []);
  const farms = usePolling(farmsFetcher, FARM_POLL_MS, []);

  const candidates = useMemo(
    () => sortCandidates(filterCandidates(list.data?.candidates ?? [], query), sort),
    [list.data, query, sort],
  );
  const farmList = farms.data?.farms ?? [];

  const onFarm = async (candidate: AirdropCandidate) => {
    await startFarm({ name: candidate.name, slug: candidate.slug });
    farms.refresh();
  };

  const data = list.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Nghiên cứu airdrop</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Dự án đang giữ tiền thật (TVL) nhưng chưa có token, lấy từ DefiLlama mỗi 6 tiếng. Đây là danh sách để nghiên
          cứu, không phải dự đoán: nhiều dự án không bao giờ ra token, có dự án ra token mà không chia cho người dùng,
          và token mới ra có thể vài ngày sau mới được cập nhật. Chi phí gas là tiền thật, airdrop thì chưa chắc.
        </p>
        <Link href="/guide/airdrop" className="mt-2 inline-block text-xs font-semibold text-sky-300 hover:text-sky-200">
          Chiến thuật làm airdrop hiệu quả →
        </Link>
      </div>

      {farms.error && !farms.data ? (
        <StatePanel tone="error" title="Không tải được farm" detail={farms.error} />
      ) : (
        <FarmPanel farms={farmList} onChanged={farms.refresh} />
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {AIRDROP_SORTS.map((s) => (
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
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE_SIZE);
            }}
            placeholder="Lọc: tên, mảng, chain (vd Base, Lending)"
            aria-label="Lọc dự án"
            className="min-h-[36px] w-full rounded-md border border-slate-800 bg-slate-950 px-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none sm:w-72"
          />
        </div>

        {data && (
          <p className="text-xs text-slate-500">
            {candidates.length} dự án · dữ liệu ngày {data.day ?? '—'}
            {data.fetch?.lastSuccessAt && ` · quét lần cuối ${formatAgoVi(data.fetch.lastSuccessAt, data.serverTime)}`}
            {data.fetch && data.fetch.consecutiveFailures > 0 && (
              <span className="text-amber-300"> · {data.fetch.consecutiveFailures} lần quét lỗi liên tiếp</span>
            )}
          </p>
        )}

        {list.loading && !data ? (
          <LoadingPanel label="Đang tải danh sách…" />
        ) : list.error && !data ? (
          <StatePanel tone="error" title="Không gọi được API" detail={list.error} />
        ) : data && !data.enabled ? (
          <StatePanel title="Danh sách airdrop đang tắt" detail="Worker đang đặt AIRDROP_SCAN=off." />
        ) : candidates.length === 0 ? (
          <StatePanel
            title={query ? 'Không có dự án khớp bộ lọc' : 'Chưa có danh sách'}
            detail={
              query
                ? 'Thử từ khoá khác.'
                : data?.fetch?.lastError
                  ? `Lần quét gần nhất lỗi: ${data.fetch.lastError}`
                  : 'Worker quét lần đầu 5 phút sau khi khởi động, sau đó 6 tiếng một lần.'
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {candidates.slice(0, shown).map((c) => (
                <CandidateCard key={c.slug} candidate={c} farm={activeFarmFor(c, farmList)} onFarm={onFarm} />
              ))}
            </div>
            {shown < candidates.length && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
                className="w-full rounded-md border border-slate-800 py-2 text-xs font-semibold text-slate-300 hover:border-slate-700"
              >
                Xem thêm ({candidates.length - shown})
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
