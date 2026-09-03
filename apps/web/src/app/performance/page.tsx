'use client';

import { useCallback, useState } from 'react';
import { getPerformance } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { UNREPLAYABLE_SIGNAL_TYPES, type Horizon, type PerformanceSource } from '@/lib/types';
import { HorizonSwitcher } from '@/components/performance/HorizonSwitcher';
import { PerformanceCard } from '@/components/performance/PerformanceCard';
import { BaselinePanel } from '@/components/performance/BaselinePanel';
import { SourceSwitcher } from '@/components/performance/SourceSwitcher';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';

const POLL_MS = 60_000;

export default function PerformancePage() {
  const [horizon, setHorizon] = useState<Horizon>('1h');
  const [source, setSource] = useState<PerformanceSource>('live');
  const fetcher = useCallback(() => getPerformance(horizon, source), [horizon, source]);
  const performance = usePolling(fetcher, POLL_MS, [horizon, source]);
  const isBootstrapping = performance.loading && !performance.data;
  // Only the cards that actually render a verdict belong to the family; the
  // "not enough data" ones make no claim, so counting them would penalise
  // the rest for nothing.
  const comparisons = performance.data?.results.filter((r) => r.sufficientData).length ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Hiệu quả tín hiệu trong quá khứ</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Giá đã đi thế nào sau khi mỗi loại tín hiệu bật, ở khung thời gian đang chọn. Chỉ hiện số khi loại
            tín hiệu đó có ít nhất 30 kết quả đã ghi nhận — dưới ngưỡng đó trang này từ chối khẳng định một lợi
            thế chưa có bằng chứng. Đọc mọi thẻ dựa trên baseline ngay bên dưới: một tỉ lệ đúng chỉ có nghĩa khi
            nó vượt được mức giá vốn dĩ đã tự đi trong cùng khoảng thời gian.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <HorizonSwitcher value={horizon} onChange={setHorizon} />
          <SourceSwitcher value={source} onChange={setSource} />
        </div>
      </div>

      {isBootstrapping ? (
        <LoadingPanel label="Đang tải dữ liệu hiệu quả…" />
      ) : performance.error && !performance.data ? (
        <StatePanel tone="error" title="Không kết nối được tới API" detail={performance.error} />
      ) : (
        <>
          {source !== 'live' && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/80">
              Mẫu &ldquo;Replay&rdquo; đến từ việc chạy lại engine trên dữ liệu thị trường lịch sử. Đó là phép đo
              thật, nhưng đo một thứ yếu hơn: sàn không lưu lịch sử thanh lý, nên{' '}
              <span className="font-semibold">{UNREPLAYABLE_SIGNAL_TYPES.join(' và ')}</span> hoàn toàn không thể
              bật ở đây — số 0 ở hai loại đó nghĩa là <em>không đo được</em>, không phải là mẫu hình chưa từng xảy
              ra. Open Interest cũng chỉ tra ngược được 30 ngày, giới hạn luôn độ dài của bản replay.
            </div>
          )}
          {/* A page that says "not enough data" while thousands of replayed
              outcomes sit one click away is a dead end pretending to be an
              answer. The switcher above is easy to miss, so when the
              selected source has nothing usable, say where the data is. */}
          {source === 'live' &&
            performance.data &&
            performance.data.results.every((r) => !r.sufficientData) && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs leading-relaxed text-sky-200/80">
                Chưa tín hiệu nào đủ mẫu ở nguồn <span className="font-semibold">Live</span>. Dữ liệu{' '}
                <button
                  type="button"
                  onClick={() => setSource('backfill')}
                  className="font-semibold text-sky-300 underline decoration-sky-500/50 underline-offset-2"
                >
                  Replay
                </button>{' '}
                tính lại engine trên 30 ngày lịch sử nên thường có nhiều mẫu hơn — kèm cảnh báo về những gì nó không
                đo được.
              </div>
            )}
          {performance.data && <BaselinePanel baseline={performance.data.baseline} />}
          {comparisons > 1 && (
            <p className="text-[11px] leading-relaxed text-slate-500">
              {comparisons} thẻ đang cùng đưa ra kết luận trên màn hình này, nên khoảng sai số (±pp) đã được nới
              ra theo số phép so sánh: một phép kiểm định 95% sai 1 lần trên 20, chạy {comparisons} lần cùng lúc
              thì gần như chắc chắn có một thẻ &ldquo;có ý nghĩa&rdquo; do ngẫu nhiên. Bấm qua lại giữa các khung
              thời gian và nguồn dữ liệu còn nới rộng thêm nữa — phần đó trang không tự trừ hao được, bro tự trừ
              trong đầu giúp.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {performance.data?.results.map((result) => (
              <PerformanceCard
                key={result.signalType}
                result={result}
                baseline={performance.data!.baseline}
                comparisons={comparisons}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
