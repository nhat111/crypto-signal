'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { getCoins, getCoinsLive } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { useTrackedSymbols } from '@/lib/useTrackedSymbols';
import { cx, formatRelativeTime } from '@/lib/format';
import { FLOW_META, sortCoins, type CoinSort } from '@/lib/coinFlow';
import type { CoinFlow, CoinsLiveResponse, CoinsResponse } from '@/lib/types';
import { CoinTable, FlowBadge } from '@/components/coins/CoinTable';
import { CoinEdgePanel } from '@/components/coins/CoinEdgePanel';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

/** The scan changes once a day; a ten-minute poll only catches the morning's run. */
const POLL_MS = 10 * 60_000;
/** The live column only; the API reuses one OKX read for 30 s, so a minute is plenty. */
const LIVE_POLL_MS = 60_000;

const SORTS: Array<{ key: CoinSort; label: string }> = [
  { key: 'rs30', label: 'Mạnh vs BTC 30N' },
  { key: 'rs7', label: 'Mạnh vs BTC 7N' },
  { key: 'volume', label: 'Volume' },
];

const LEGEND_ORDER: CoinFlow[] = [
  'spot_led',
  'accumulation',
  'spot_and_leverage',
  'leverage_led',
  'short_squeeze',
  'short_covering',
  'leverage_building',
  'long_unwind',
  'spot_selling',
  'shorts_building',
  'distribution',
  'up_unconfirmed',
  'down_unconfirmed',
  'quiet',
];

export default function CoinsPage() {
  const coins = usePolling(getCoins, POLL_MS, []);
  const live = usePolling(getCoinsLive, LIVE_POLL_MS, []);
  const tracked = useTrackedSymbols();
  const [sort, setSort] = useState<CoinSort>('rs30');
  const rows = useMemo(() => sortCoins(coins.data?.rows ?? [], sort), [coins.data, sort]);

  return (
    <div className="space-y-4 pb-16">
      <header>
        <h1 className="text-lg font-bold text-slate-100">Top coin</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
          Các coin có volume spot lớn nhất (Binance, hoặc OKX khi Binance chặn máy chủ), đọc một lần mỗi ngày sau khi nến 1D đóng. Hai câu hỏi: coin nào
          đang <b className="text-slate-300">mạnh hơn BTC</b> (phần lớn altcoin chỉ là BTC với biến động lớn hơn), và
          7 ngày qua giá được kéo bởi <b className="text-slate-300">spot mua thật hay đòn bẩy</b>. Bấm vào một dòng để
          xem số liệu đằng sau nhãn. Cột <b className="text-slate-300">Cơ bản</b> lấy phí, TVL và stablecoin của chain hoặc
          protocol từ DefiLlama (chỉ tính khi phí đổi ≥20%, TVL ≥10%, stablecoin ≥5%); lịch unlock token chưa có vì chưa có
          nguồn miễn phí.{' '}
          <Link href="/guide#oi-funding" className="font-semibold text-sky-300 hover:text-sky-200">
            OI và funding là gì? →
          </Link>
        </p>
      </header>

      <Body state={coins} rows={rows} tracked={tracked} sort={sort} onSort={setSort} live={live.data} />

      <CoinEdgePanel />

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Nhãn dòng tiền đọc thế nào</h2>
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          {LEGEND_ORDER.map((flow) => (
            <div key={flow} className="flex items-start gap-2">
              <dt className="shrink-0"><FlowBadge flow={flow} /></dt>
              <dd className="text-slate-400">{FLOW_META[flow].meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          {coins.data?.thresholds
            ? `Ngưỡng: giá ±${coins.data.thresholds.priceMovePct}% trong 7 ngày là có chuyển động; spot lệch ±${(coins.data.thresholds.takerSkew * 100).toFixed(0)}% khối lượng là mua/bán ròng; OI ${coins.data.thresholds.oiRisePct > 0 ? '+' : ''}${coins.data.thresholds.oiRisePct}% / ${coins.data.thresholds.oiFallPct}% theo hợp đồng; funding từ ${coins.data.thresholds.fundingElevatedPct}%/8h là long trả cao. `
            : ''}
          Các ngưỡng là giả định ban đầu; bảng Kiểm chứng ở trên đo xem nhãn nào thật sự đi trước giá. Mô tả 7–30 ngày đã qua, không phải dự báo — mạnh hơn BTC chưa phải là lý do để mua.
        </p>
      </section>
    </div>
  );
}

function Body({
  state,
  rows,
  tracked,
  sort,
  onSort,
  live,
}: {
  state: { data: CoinsResponse | null; error: string | null; loading: boolean };
  live: CoinsLiveResponse | null;
  rows: CoinsResponse['rows'];
  tracked: string[];
  sort: CoinSort;
  onSort: (s: CoinSort) => void;
}) {
  if (state.loading && !state.data) return <LoadingPanel label="Đang đọc top coin…" />;
  if (!state.data) {
    return <StatePanel tone="error" title="Không đọc được dữ liệu top coin" detail={state.error ?? undefined} />;
  }
  const { data } = state;
  if (!data.enabled) {
    return <StatePanel title="Quét top coin đang tắt" detail="Đặt COIN_SCAN=on cho service worker để bật." />;
  }
  if (rows.length === 0) {
    const failing = data.fetch && data.fetch.consecutiveFailures > 0;
    return (
      <StatePanel
        tone={failing ? 'error' : 'neutral'}
        title={failing ? 'Lần quét gần nhất bị lỗi' : 'Chưa có lần quét nào'}
        detail={failing ? data.fetch?.lastError ?? undefined : 'Worker quét một lần mỗi ngày sau khi nến 1D đóng (7h sáng giờ VN); lần đầu chạy ngay khi worker khởi động.'}
      />
    );
  }

  const computedAt = Math.max(...rows.map((r) => r.computedAt));
  const failingSince = data.fetch && data.fetch.consecutiveFailures > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={sort === s.key}
              onClick={() => onSort(s.key)}
              className={cx(
                'min-h-[32px] rounded-md px-3 text-xs font-medium transition-colors',
                sort === s.key ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          {rows.length} coin · nến 1D đến {data.day?.split('-').reverse().join('/')} · quét {formatRelativeTime(computedAt)}
        </p>
      </div>
      {data.exchange === 'okx' && (
        <p className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-200">
          Nguồn hôm nay: <b>OKX</b>. Binance đang chặn IP máy chủ, nên danh sách, hạng volume, mua/bán chủ động, OI và
          funding đều lấy từ OKX — dòng tiền trên hai sàn có thể khác nhau.
        </p>
      )}
      {failingSince && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          Lần quét mới nhất bị lỗi ({data.fetch?.lastError}) — đang hiển thị lần quét thành công trước đó.
        </p>
      )}
      {data.watchlist && data.watchlist.length > 0 && (
        <p className="text-xs text-slate-400">
          ⭐ Danh sách theo dõi: <b className="text-slate-200">{data.watchlist.map((s) => s.replace(/USDT$/, '')).join(', ')}</b>. Mạnh hơn BTC
          trong 30 ngày và vẫn đang mạnh lên, không có dòng bán, không có số liệu sử dụng chỉ giảm. Setup 4H trên các coin này được báo
          Telegram và so với setup trên các coin còn lại ở mục Setup 4H trang chủ.
        </p>
      )}
      <CoinTable rows={rows} trackedSymbols={tracked} watchlist={data.watchlist} closeDay={data.day} live={live} />
    </div>
  );
}
