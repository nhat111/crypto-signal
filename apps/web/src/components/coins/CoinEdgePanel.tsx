'use client';

import { useState } from 'react';
import { getCoinEdge } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { cx, formatPct } from '@/lib/format';
import { FLOW_META, edgeVerdictText, type FlowTone } from '@/lib/coinFlow';
import type { CoinEdgeComparison, CoinEdgeGroup } from '@/lib/types';

const TONE: Record<FlowTone, string> = {
  good: 'text-emerald-300',
  mixed: 'text-amber-200',
  warn: 'text-orange-300',
  bad: 'text-red-300',
  neutral: 'text-slate-400',
};

const EXCHANGE: Record<string, string> = { binance: 'Binance', okx: 'OKX' };

function Group({ g }: { g: CoinEdgeGroup }) {
  return (
    <span className="tabular-nums">
      {g.hitPct === null ? '—' : `${g.hitPct.toFixed(0)}%`}
      <span className="text-slate-600"> · n={g.samples}</span>
    </span>
  );
}

function Verdict({ c, minSamples }: { c: CoinEdgeComparison; minSamples: number }) {
  const v = edgeVerdictText(c, minSamples);
  return <span className={cx('text-xs font-medium', TONE[v.tone])}>{v.text}</span>;
}

/**
 * Whether the scan's groups went on to beat BTC — the same test signals get
 * on /performance. Shown under the table rather than on a page of its own,
 * because a label is only worth reading next to the evidence for it.
 */
export function CoinEdgePanel() {
  const [horizon, setHorizon] = useState<7 | 30>(7);
  const edge = usePolling(() => getCoinEdge(horizon), 30 * 60_000, [horizon]);
  const data = edge.data;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">Kiểm chứng: nhãn có báo trước giá không?</h2>
        <div className="flex gap-1">
          {([7, 30] as const).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHorizon(h)}
              aria-pressed={horizon === h}
              className={cx(
                'min-h-[32px] rounded-md px-3 text-xs font-medium',
                horizon === h ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
              )}
            >
              {h} ngày sau
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        &quot;Thắng&quot; = lãi hơn BTC trong {horizon} ngày sau ngày quét. Mỗi nhóm so với mức nền bằng cùng kiểm định
        như trang Performance; mốc ngày cách nhau {horizon} ngày để không đếm một tuần nhiều lần; Binance và OKX tính
        riêng.
      </p>

      {edge.loading && !data ? (
        <p className="text-xs text-slate-500">Đang tính…</p>
      ) : !data ? (
        <p className="text-xs text-red-300">Không đọc được kết quả kiểm chứng{edge.error ? `: ${edge.error}` : ''}.</p>
      ) : data.reports.every((r) => r.cohortDays === 0) ? (
        <p className="text-xs text-slate-400">
          Chưa có mốc ngày nào đủ {horizon} ngày để đo. Kết quả đầu tiên có sau khoảng {horizon} ngày lưu dữ liệu, và cần
          ít nhất {data.minSamples} mẫu mỗi nhóm mới kết luận.
        </p>
      ) : (
        <div className="space-y-4">
          {data.reports
            .filter((r) => r.cohortDays > 0)
            .map((r) => (
              <div key={r.exchange} className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">
                  {EXCHANGE[r.exchange] ?? r.exchange} <span className="font-normal text-slate-500">· {r.cohortDays} mốc ngày</span>
                </h3>
                <div className="rounded-md border border-slate-800 p-2 text-xs text-slate-300">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>20% mạnh nhất vs BTC (30N) so với 20% yếu nhất</span>
                    <Verdict c={r.relativeStrength} minSamples={data.minSamples} />
                  </div>
                  <div className="mt-1 text-slate-400">
                    Mạnh nhất thắng BTC: <Group g={r.relativeStrength.group} /> · Yếu nhất: <Group g={r.relativeStrength.baseline} />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-xs">
                    <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="py-1 pr-2 font-medium">Nhãn</th>
                        <th className="py-1 pr-2 text-right font-medium">Thắng BTC</th>
                        <th className="py-1 pr-2 text-right font-medium">Lãi hơn BTC TB</th>
                        <th className="py-1 font-medium">Kết luận</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.flows.map((f) => (
                        <tr key={f.flow} className="border-t border-slate-800/60">
                          <td className="py-1 pr-2 text-slate-300">{FLOW_META[f.flow]?.label ?? f.flow}</td>
                          <td className="py-1 pr-2 text-right text-slate-300">
                            <Group g={f.group} />
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums text-slate-300">{formatPct(f.group.meanExcessPct, 1)}</td>
                          <td className="py-1">
                            <Verdict c={f} minSamples={data.minSamples} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {r.flows[0] && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Mức nền: mọi coin cùng mốc ngày thắng BTC <Group g={r.flows[0].baseline} />.
                    </p>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
