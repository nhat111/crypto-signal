import type { LookupResult, LookupTechnical } from '@/lib/types';
import { SafetyBadge } from '@/components/gems/SafetyBadge';
import { formatTokenPrice, formatUsd } from '@/lib/format';

/**
 * The answer to one lookup.
 *
 * Two shapes because they are two different kinds of thing: an exchange
 * ticker has a chart and no supply data, a DEX token has a pool and a
 * contract and no candle history. Rendering them through one merged
 * layout would mean filling the other half with dashes, and a dash reads
 * as "zero" far more often than as "we do not have this".
 *
 * Whatever could not be read is printed by name at the bottom instead.
 */
export function LookupResultView({ result }: { result: LookupResult }) {
  if (result.kind === 'exchange') {
    return (
      <div className="space-y-4">
        <Header title={result.symbol} subtitle={`Binance · khung ${result.timeframe} · ${result.technical.barCount} nến`} />
        <TechnicalPanel read={result.technical} />
        <UnknownsPanel
          title="Phần cơ bản chưa có dữ liệu"
          items={result.fundamentals.unknowns}
          note="Với mã trên sàn, dự án chưa nối nguồn nào cho cung/vốn hoá. Suy vốn hoá từ giá là con số bịa, nên không hiện."
        />
      </div>
    );
  }

  const f = result.fundamentals;
  return (
    <div className="space-y-4">
      <Header
        title={`${f.symbol} · ${f.name}`}
        subtitle={`${f.chainId} · ${f.dexId}`}
        badge={<SafetyBadge verdict={f.safetyVerdict} />}
      />

      <Panel title="Cơ bản on-chain">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
          <Metric label="Giá" value={formatTokenPrice(f.priceUsd)} />
          <Metric label="Thanh khoản" value={f.liquidityUsd === null ? '—' : formatUsd(f.liquidityUsd)} />
          <Metric label="FDV" value={f.fdvUsd === null ? '—' : formatUsd(f.fdvUsd)} />
          <Metric label="Vốn hoá" value={f.marketCapUsd === null ? '—' : formatUsd(f.marketCapUsd)} />
          <Metric label="Vol 24h" value={f.volume24hUsd === null ? '—' : formatUsd(f.volume24hUsd)} />
          <Metric label="Tuổi pool" value={f.ageDays === null ? '—' : `${Math.floor(f.ageDays)} ngày`} />
          <Metric
            label="Thanh khoản / FDV"
            value={f.liquidityToFdvPct === null ? '—' : `${f.liquidityToFdvPct.toFixed(2)}%`}
            hint="Pool mỏng so với định giá thì giá dễ bị đẩy."
          />
          <Metric
            label="Vol / Thanh khoản"
            value={f.volumeToLiquidity === null ? '—' : `${f.volumeToLiquidity.toFixed(2)}×`}
            hint="Rất cao là pool đang bị quay vòng; rất thấp là gần như không ai giao dịch."
          />
        </dl>
      </Panel>

      <Panel title="Kiểm định hợp đồng">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
          <Metric label="Ví lớn nhất" value={f.topHolderPct === null ? '—' : `${(f.topHolderPct * 100).toFixed(1)}%`} />
          <Metric label="LP đã khoá" value={yesNo(f.lpLocked)} />
          <Metric label="Thu hồi quyền mint" value={yesNo(f.mintAuthorityRevoked)} />
          <Metric label="Thu hồi quyền freeze" value={yesNo(f.freezeAuthorityRevoked)} />
        </dl>
        {f.safetyFlags.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-amber-300/80">
            {f.safetyFlags.map((flag, i) => (
              <li key={i}>• {flag}</li>
            ))}
          </ul>
        )}
      </Panel>

      {result.otherPools.length > 0 && (
        <Panel title="Pool khác của token này">
          <ul className="space-y-1 text-xs text-slate-400">
            {result.otherPools.map((p, i) => (
              <li key={i}>
                {p.chainId} · {p.dexId} — {p.liquidityUsd === null ? 'thanh khoản không rõ' : formatUsd(p.liquidityUsd)}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <UnknownsPanel
        title="Chưa đọc được"
        items={f.unknowns}
        note="Số liệu kỹ thuật (RSI, EMA, hỗ trợ/kháng cự) cần lịch sử nến, mà nguồn DEX miễn phí không trả về — nên phần đó để trống thay vì ước lượng từ vài con số phần trăm."
      />
    </div>
  );
}

function TechnicalPanel({ read }: { read: LookupTechnical }) {
  return (
    <Panel title="Kỹ thuật">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
        <Metric label="Giá" value={formatTokenPrice(read.lastPrice)} />
        <Metric label="RSI 14" value={read.rsi14 === null ? '—' : read.rsi14.toFixed(1)} />
        <Metric
          label="Xu hướng"
          value={read.trend === null ? '—' : trendLabel(read.trend.direction)}
          hint={read.trend === null ? undefined : `EMA20 so EMA50: ${read.trend.separationPct.toFixed(2)}%`}
        />
        <Metric label="Biên độ (ATR)" value={read.atrPct === null ? '—' : `${read.atrPct.toFixed(2)}%`} />
        <Metric label="Đáy gần nhất" value={read.support === null ? '—' : formatTokenPrice(read.support)} />
        <Metric label="Đỉnh gần nhất" value={read.resistance === null ? '—' : formatTokenPrice(read.resistance)} />
        <Metric
          label="Vị trí trong biên"
          value={read.rangePositionPct === null ? '—' : `${read.rangePositionPct.toFixed(0)}/100`}
          hint="0 là đáy của cả khoảng đang xét, 100 là đỉnh."
        />
        <Metric
          label="Đổi qua 24 nến"
          value={read.changePct.last24Bars === null ? '—' : `${read.changePct.last24Bars >= 0 ? '+' : ''}${read.changePct.last24Bars.toFixed(2)}%`}
        />
      </dl>
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        Đây là <span className="font-semibold text-slate-400">mô tả</span> giá đang đứng ở đâu so với chính lịch sử
        gần đây của nó, không phải dự báo. Hệ thống này không có kết quả đã ghi nhận nào cho các chỉ báo trên, nên nó
        không nói con nào nên mua hay bán.
      </p>
      {read.missing.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-300/80">
          Chưa đủ lịch sử cho: {read.missing.join(' · ')}.
        </p>
      )}
    </Panel>
  );
}

function UnknownsPanel({ title, items, note }: { title: string; items: string[]; note: string }) {
  return (
    <Panel title={title}>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">Đọc được hết.</p>
      ) : (
        <ul className="space-y-1 text-xs text-slate-400">
          {items.map((item, i) => (
            <li key={i}>• {item}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{note}</p>
    </Panel>
  );
}

function Header({ title, subtitle, badge }: { title: string; subtitle: string; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-base font-bold text-slate-100">{title}</h2>
      {badge}
      <span className="text-xs text-slate-500">{subtitle}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-slate-800/70 bg-slate-950/40 px-2 py-1.5" title={hint}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="tabular-nums text-slate-200">{value}</dd>
    </div>
  );
}

/** Three states, never two: "chưa rõ" is not "không". */
function yesNo(value: boolean | null): string {
  if (value === null) return 'chưa rõ';
  return value ? 'có' : 'không';
}

function trendLabel(direction: 'up' | 'down' | 'sideways'): string {
  if (direction === 'up') return 'EMA20 > EMA50';
  if (direction === 'down') return 'EMA20 < EMA50';
  return 'đi ngang';
}
