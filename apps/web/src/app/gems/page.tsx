'use client';

import { useCallback, useState } from 'react';
import { getGemPerformance, getGems } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import type { GemHorizon, GemBaselineComparison } from '@/lib/types';
import { GemCard } from '@/components/gems/GemCard';
import { LoadingPanel, StatePanel } from '@/components/StatePanel';
import { cx } from '@/lib/format';

const POLL_MS = 60_000;
const LIST_LIMIT = 60;
const HORIZONS: GemHorizon[] = ['24h', '7d'];

export default function GemsPage() {
  const [horizon, setHorizon] = useState<GemHorizon>('7d');

  const gemsFetcher = useCallback(() => getGems({ limit: LIST_LIMIT }), []);
  const gems = usePolling(gemsFetcher, POLL_MS, []);

  const perfFetcher = useCallback(() => getGemPerformance(horizon), [horizon]);
  const performance = usePolling(perfFetcher, POLL_MS, [horizon]);

  const isBootstrapping = gems.loading && !gems.data;
  const list = gems.data?.gems ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Small-cap candidates</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Tokens from public DEX data that fit a small-cap profile and have already survived a while. These are
          screening results, not recommendations — small caps can lose most or all of their value quickly, and a
          safety screen cannot rule out every risk.
        </p>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-200">Has this scanner actually worked?</h2>
          <div className="flex gap-1">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={cx(
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  h === horizon ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
                )}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <GemPerformancePanel data={performance.data} loading={performance.loading} error={performance.error} />
      </section>

      {isBootstrapping ? (
        <LoadingPanel label="Loading candidates…" />
      ) : gems.error && !gems.data ? (
        <StatePanel tone="error" title="Could not reach the API" detail={gems.error} />
      ) : list.length === 0 ? (
        <StatePanel
          title="No candidates right now"
          detail="Either the scanner is disabled, has not run yet, or nothing in its sample passed the filters."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {list.map((gem) => (
            <GemCard key={gem.scanId} gem={gem} />
          ))}
        </div>
      )}
    </div>
  );
}

interface PerformancePanelProps {
  data: import('@/lib/types').GemPerformance | null;
  loading: boolean;
  error: string | null;
}

/**
 * Refuses to show percentages until there are enough recorded outcomes.
 * A scanner that quotes a win rate off three samples is worse than one
 * that admits it doesn't know yet.
 */
function GemPerformancePanel({ data, loading, error }: PerformancePanelProps) {
  if (loading && !data) return <p className="text-xs text-slate-500">Đang tải…</p>;
  if (error && !data) return <p className="text-xs text-rose-400">{error}</p>;
  if (!data) return null;

  if (!data.sufficientData) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/50 p-3">
        <p className="text-sm font-semibold text-slate-300">
          Chưa đủ dữ liệu ({data.sampleCount}/20 kết quả)
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Số liệu chỉ hiện khi có ít nhất 20 token đã được ghi nhận kết quả sau {data.horizon}. Trước đó, scanner
          này <span className="font-semibold text-slate-400">chưa có thành tích nào</span> — hãy đối xử với mọi ứng
          viên đúng như vậy.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Số mẫu" value={String(data.sampleCount)} />
        <Stat label="Đi lên" value={data.positiveMovePct === null ? '—' : `${data.positiveMovePct}%`} />
        <Stat label="Trung vị" value={data.medianMovePct === null ? '—' : `${data.medianMovePct}%`} />
        <Stat
          label="Cạn thanh khoản"
          value={data.liquidityCollapsePct === null ? '—' : `${data.liquidityCollapsePct}%`}
          hint="Tỉ lệ token được đưa lên rồi thanh khoản tụt xuống dưới 20% so với lúc quét."
        />
      </dl>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Bốn ô trên tính trên những token <span className="font-semibold text-slate-400">đủ điểm để báo động</span>{' '}
        — tức &ldquo;khi scanner thật sự gọi tên một cái gì đó thì sau đó ra sao&rdquo;. Bảng bên dưới thì tính
        trên <span className="font-semibold text-slate-400">mọi token qua được vòng lọc</span>, vì không có nhóm
        điểm thấp thì không so được điểm cao với cái gì.
      </p>
      <MarketBaselinePanel baseline={data.baseline} />
      <ScoreEdgePanel edge={data.scoreEdge} />
      <ComponentEdgePanel edges={data.componentEdges} />
    </div>
  );
}

/**
 * The control group, and the only thing that makes the headline mean
 * anything.
 *
 * "14,5% đi lên, trung vị −21%" reads as a verdict on the scanner and is
 * not one: every token in it passed the same filter, so the number cannot
 * separate a bad scanner from a bad week for small caps. This compares it
 * against tokens the scanner REJECTED for being the wrong profile — too
 * big, too new, already pumped — each of which was something the reader
 * could genuinely have bought instead that day.
 */
function MarketBaselinePanel({ baseline }: { baseline?: GemBaselineComparison }) {
  if (!baseline || baseline.sampleCount === 0) return null;

  const tone =
    baseline.verdict === 'beats' ? 'text-emerald-400' : baseline.verdict === 'worse' ? 'text-rose-400' : 'text-slate-400';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-300">So với token bị loại</h4>
        <span className="text-[11px] text-slate-500">{baseline.sampleCount} mẫu đối chứng</span>
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-3">
        <Stat
          label="Ăn được phí (đối chứng)"
          value={baseline.netPositiveMovePct === null ? '—' : `${baseline.netPositiveMovePct}%`}
          hint="Tỉ lệ token bị loại tăng đủ để bù 3% phí đi-về, tính trên cùng mốc phí như số của scanner."
        />
        <Stat
          label="Trung vị (đối chứng)"
          value={baseline.medianMovePct === null ? '—' : `${baseline.medianMovePct}%`}
        />
      </dl>

      {!baseline.sufficientData ? (
        <p className="mt-2.5 text-[11px] leading-relaxed text-amber-300/80">
          Mới {baseline.sampleCount}/20 mẫu đối chứng — chưa đủ để kết luận gì. Con số trên chỉ để nhìn, chưa phải
          bằng chứng.
        </p>
      ) : (
        <p className={`mt-2.5 text-[11px] font-semibold leading-relaxed ${tone}`}>
          {baseline.verdict === 'beats' &&
            `Scanner hơn nhóm đối chứng ${baseline.deltaPp.toFixed(1)} điểm phần trăm — lớn hơn sai số ${baseline.marginPp?.toFixed(1) ?? '—'}.`}
          {baseline.verdict === 'worse' &&
            `Scanner KÉM hơn nhóm đối chứng ${Math.abs(baseline.deltaPp).toFixed(1)} điểm phần trăm. Mua đại một token bị loại còn hơn.`}
          {baseline.verdict === 'indistinguishable' &&
            `Chênh ${baseline.deltaPp.toFixed(1)} điểm phần trăm, chưa vượt sai số ${baseline.marginPp?.toFixed(1) ?? '—'} — tức là chưa phân biệt được với may rủi.`}
        </p>
      )}

      {baseline.medianDeltaPp !== null && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Trung vị chênh {baseline.medianDeltaPp > 0 ? '+' : ''}
          {baseline.medianDeltaPp}%. Con số này{' '}
          <span className="font-semibold text-slate-400">không kèm kiểm định</span> — trung vị không phải tỉ lệ, chạy
          công thức tỉ lệ lên nó sẽ ra một con số trông chặt chẽ mà không phải vậy.
        </p>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        Nhóm đối chứng chỉ gồm token bị loại vì <span className="font-semibold text-slate-400">sai hồ sơ</span> (quá
        lớn, quá mới, đã bơm quá mạnh) — những thứ bro thật sự có thể mua thay thế. Token bị loại vì thanh khoản
        quá mỏng hoặc thiếu dữ liệu không được tính: giá của chúng không phải giá mua được, đưa vào chỉ làm scanner
        đẹp lên một cách giả tạo.
      </p>
    </div>
  );
}

/**
 * The question the scanner could not answer about itself: does a higher
 * Gem Score actually precede better outcomes?
 *
 * Put directly under the headline numbers because those numbers are
 * unreadable without it. "60% đi lên" in a week when everything went up
 * says nothing about the score — only the gap between a high-scoring token
 * and a low-scoring one does, and if that gap is not there then the score
 * is decoration and so is every alert built on it.
 */
function ScoreEdgePanel({ edge }: { edge?: import('@/lib/types').GemScoreEdge }) {
  // Absent means an API that predates this, which is not the same as "no
  // edge" — saying the latter would be inventing a finding.
  if (!edge) return null;

  const verdict = edge.verdict;
  const tone =
    verdict?.verdict === 'beats'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200/90'
      : verdict?.verdict === 'worse'
        ? 'border-rose-500/30 bg-rose-500/5 text-rose-200/90'
        : 'border-slate-700 bg-slate-950/50 text-slate-400';

  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
        Điểm Gem có tác dụng không?
      </p>

      {verdict === null ? (
        <div className="mt-1 space-y-1.5 text-sm">
          <p>
            Chưa so được. Cần ít nhất 20 kết quả ở <span className="font-semibold">cả hai đầu</span> thang điểm
            (dưới 50 và từ 70 trở lên) thì mới trả lời được câu này.
          </p>
          {/* The most likely reason the low bands are empty, said out loud
              rather than left as a shrug: for a long time outcomes were
              only recorded above the alert threshold, so there is simply no
              history of low-scoring tokens to compare against. */}
          <p className="text-[11px] leading-relaxed opacity-80">
            Nếu bậc thấp đang là 0 mẫu: trước đây hệ thống chỉ theo dõi kết quả của token đủ điểm để báo động,
            nên không có đối chứng nào cả. Từ bản này trở đi mọi token qua được vòng lọc đều được theo dõi — bậc
            thấp sẽ đầy dần, và cần khoảng một tuần cho mốc 7d.
          </p>
        </div>
      ) : verdict.verdict === 'beats' ? (
        <p className="mt-1 text-sm">
          <span className="font-bold">Có.</span> Token nhóm {bandName(verdict, 'high')} đi lên nhiều hơn nhóm{' '}
          {bandName(verdict, 'low')}{' '}
          <span className="font-bold tabular-nums">{verdict.deltaPp.toFixed(0)}pp</span>
          {verdict.marginPp !== null && <span className="opacity-70"> (±{verdict.marginPp.toFixed(0)}pp)</span>} — đủ
          lớn so với sai số.
        </p>
      ) : verdict.verdict === 'worse' ? (
        <p className="mt-1 text-sm">
          <span className="font-bold">Ngược lại.</span> Token nhóm {bandName(verdict, 'high')} còn đi{' '}
          <span className="font-bold">kém hơn</span> nhóm {bandName(verdict, 'low')}{' '}
          {Math.abs(verdict.deltaPp).toFixed(0)}pp
          {verdict.marginPp !== null && <span className="opacity-70"> (±{verdict.marginPp.toFixed(0)}pp)</span>}.
          Trọng số chấm điểm đang sai hướng.
        </p>
      ) : (
        <p className="mt-1 text-sm">
          <span className="font-bold">Chưa chứng minh được.</span> Chênh lệch{' '}
          {verdict.deltaPp >= 0 ? '+' : ''}
          {verdict.deltaPp.toFixed(0)}pp còn nhỏ hơn sai số
          {verdict.marginPp !== null && ` ±${verdict.marginPp.toFixed(0)}pp`}.
          {verdict.samplesNeeded != null
            ? ` Cần khoảng ${verdict.samplesNeeded.toLocaleString('vi-VN')} mẫu ở bậc điểm cao để nói chắc.`
            : ' Với lượng mẫu ở bậc thấp hiện tại thì thêm bao nhiêu token điểm cao cũng không đủ — cần thêm dữ liệu ở cả hai đầu.'}{' '}
          Tới lúc đó, điểm số <span className="font-semibold">chưa được coi là lý do để vào lệnh</span>.
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-1 font-semibold">Bậc điểm</th>
              <th className="pb-1 text-right font-semibold">Mẫu</th>
              <th className="pb-1 text-right font-semibold">Đi lên</th>
              <th className="pb-1 text-right font-semibold">Đủ bù phí</th>
              <th className="pb-1 text-right font-semibold">Trung vị</th>
              <th className="pb-1 text-right font-semibold">Cạn TK</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {edge.bands.map((band) => (
              <tr key={band.key} className="border-t border-slate-800/70">
                <td className="py-1.5 font-medium">{band.label}</td>
                <td className="py-1.5 text-right tabular-nums">{band.sampleCount}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {band.sufficientData && band.positiveMovePct !== null ? `${band.positiveMovePct}%` : '—'}
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {band.sufficientData && band.netPositiveMovePct !== null ? `${band.netPositiveMovePct}%` : '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {band.sufficientData && band.medianMovePct !== null ? `${band.medianMovePct}%` : '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {band.liquidityCollapsePct === null ? '—' : `${band.liquidityCollapsePct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        <span className="font-semibold text-slate-400">Đủ bù phí</span> = tỉ lệ lần giá đi lên{' '}
        <span className="font-semibold">quá {edge.costPct}%</span>, tức mức phí khứ hồi ước tính trên DEX (phí swap
        hai chiều + trượt giá trên pool mỏng + phí ưu tiên). Cột &ldquo;Đi lên&rdquo; đếm cả những lần nhích 1% —
        đúng hướng nhưng vào lệnh là lỗ. Con số {edge.costPct}% là <span className="font-semibold">giả định</span>,
        không phải đo đạc; ai vào lệnh chặt hoặc rộng hơn thì tự chỉnh trong đầu.
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded bg-slate-950/60 px-3 py-2" title={hint}>
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="text-base font-bold tabular-nums text-slate-100">{value}</dd>
    </div>
  );
}

/**
 * Which of the five bets the Gem Score makes actually pays.
 *
 * The table above answers "is the score worth trusting". This answers "and
 * if not, which number is wrong" — a distinction that matters because the
 * weights shipped as guesses and fixing a component that ranks backwards
 * costs one line, while inventing a new strategy costs weeks.
 *
 * Three outcomes get different words on purpose. A component that ranks
 * correctly is working. One that ranks backwards is worse than useless: it
 * is actively pulling the score the wrong way and its weight should
 * probably flip. One that barely varies is neither — it is inert, carrying
 * weight while ranking nothing, and the fix there is to make it
 * discriminate rather than to change its sign.
 */
function ComponentEdgePanel({ edges }: { edges?: import('@/lib/types').GemComponentEdge[] }) {
  if (!edges || edges.length === 0) return null;

  const decided = edges.filter((e) => e.verdict !== null).length;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Trong 5 tiêu chí, cái nào đang đúng?
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Điểm Gem là trung bình có trọng số của 5 tiêu chí. Một tiêu chí xếp hạng{' '}
        <span className="font-semibold text-slate-400">ngược</span> có thể triệt tiêu bốn tiêu chí đúng, khiến tổng
        điểm trông như vô dụng. Bảng trên nói có nên tin tổng điểm; bảng này nói phải sửa số nào.
      </p>

      <div className="mt-3 space-y-2">
        {edges.map((edge) => (
          <div key={edge.key} className="rounded border border-slate-800/70 bg-slate-950/60 px-2.5 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium text-slate-200">
                {edge.label}{' '}
                <span className="text-[11px] font-normal text-slate-500">trọng số {edge.weight}%</span>
              </p>
              <ComponentVerdict edge={edge} />
            </div>
            {edge.verdict?.comparedBands != null && (
              <p className="mt-0.5 text-[10px] text-slate-600">
                so {edge.verdict.comparedBands.low} với {edge.verdict.comparedBands.high}
              </p>
            )}
            {/* Otherwise an empty table after a formula change reads as
                "this does nothing", when it means "this has no history
                yet" — opposite conclusions, same blank row. */}
            {edge.measuredSinceVersion != null && (
              <p className="mt-0.5 text-[10px] text-sky-400/70">
                công thức vừa đổi — chỉ tính các lần quét từ bản mới, lịch sử cũ không so được
              </p>
            )}
            <p className="mt-1 text-[11px] tabular-nums text-slate-500">
              {edge.bands
                .map((b) => `${b.label}: ${b.sampleCount} mẫu${b.sufficientData && b.positiveMovePct !== null ? ` · ${b.positiveMovePct}% lên` : ''}`)
                .join('  ·  ')}
            </p>
          </div>
        ))}
      </div>

      {decided === 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Chưa tiêu chí nào đủ mẫu ở cả hai đầu để kết luận. Cần khoảng 20 kết quả ở nhóm điểm thấp và 20 ở nhóm
          điểm cao của <span className="font-semibold text-slate-400">từng</span> tiêu chí.
        </p>
      )}
      {decided > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Khoảng sai số đã nới theo <span className="font-semibold text-slate-400">5 phép so sánh cùng lúc</span> —
          chạy đủ nhiều phép kiểm định thì kiểu gì cũng có một cái trông như có ý nghĩa do ngẫu nhiên.
        </p>
      )}
    </div>
  );
}

/**
 * Which band a verdict is about, or a generic name when the server did not
 * say.
 *
 * The web app and the API deploy separately, so for a while after a
 * release the browser runs new code against an older payload. Reading
 * `comparedBands.high` straight through crashed the whole Gems page — the
 * exact failure mode already guarded against on the status and performance
 * pages, not repeated here until it broke.
 */
function bandName(
  verdict: NonNullable<import('@/lib/types').GemScoreEdge['verdict']>,
  end: 'low' | 'high',
): string {
  const named = verdict.comparedBands?.[end];
  if (named != null) return named;
  return end === 'high' ? 'điểm cao' : 'điểm thấp';
}

function ComponentVerdict({ edge }: { edge: import('@/lib/types').GemComponentEdge }) {
  if (edge.degenerate) {
    return (
      <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
        không phân loại được
      </span>
    );
  }
  if (edge.verdict === null) {
    return <span className="text-[11px] text-slate-600">chưa đủ mẫu</span>;
  }
  if (edge.verdict.verdict === 'beats') {
    return (
      <span className="text-[11px] font-semibold text-emerald-400 tabular-nums">
        đúng hướng · +{edge.verdict.deltaPp.toFixed(0)}pp
        {edge.verdict.marginPp !== null && (
          <span className="font-normal text-slate-500"> (±{edge.verdict.marginPp.toFixed(0)})</span>
        )}
      </span>
    );
  }
  if (edge.verdict.verdict === 'worse') {
    return (
      <span className="text-[11px] font-semibold text-rose-400 tabular-nums">
        NGƯỢC HƯỚNG · {edge.verdict.deltaPp.toFixed(0)}pp
        {edge.verdict.marginPp !== null && (
          <span className="font-normal text-slate-500"> (±{edge.verdict.marginPp.toFixed(0)})</span>
        )}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-slate-500 tabular-nums">
      chưa rõ · {edge.verdict.deltaPp >= 0 ? '+' : ''}
      {edge.verdict.deltaPp.toFixed(0)}pp
      {edge.verdict.marginPp !== null && ` (±${edge.verdict.marginPp.toFixed(0)})`}
    </span>
  );
}
