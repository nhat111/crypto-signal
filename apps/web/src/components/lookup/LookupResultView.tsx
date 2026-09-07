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
        <Header title={result.symbol} subtitle={`Binance · ${result.timeframe} · ${result.technical.barCount} bars`} />
        <TechnicalPanel read={result.technical} />
        <UnknownsPanel
          title="Fundamentals with no data source"
          items={result.fundamentals.unknowns}
          note="For an exchange ticker this project has no supply or market-cap source wired. Deriving a market cap from a price would be a made-up number, so none is shown."
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

      <Panel title="On-chain fundamentals">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
          <Metric label="Price" value={formatTokenPrice(f.priceUsd)} />
          <Metric label="Liquidity" value={f.liquidityUsd === null ? '—' : formatUsd(f.liquidityUsd)} />
          <Metric label="FDV" value={f.fdvUsd === null ? '—' : formatUsd(f.fdvUsd)} />
          <Metric label="Market cap" value={f.marketCapUsd === null ? '—' : formatUsd(f.marketCapUsd)} />
          <Metric label="Vol 24h" value={f.volume24hUsd === null ? '—' : formatUsd(f.volume24hUsd)} />
          <Metric label="Pool age" value={f.ageDays === null ? '—' : `${Math.floor(f.ageDays)}d`} />
          <Metric
            label="Liquidity / FDV"
            value={f.liquidityToFdvPct === null ? '—' : `${f.liquidityToFdvPct.toFixed(2)}%`}
            hint="A thin pool against the valuation means the price is easy to move."
          />
          <Metric
            label="Vol / liquidity"
            value={f.volumeToLiquidity === null ? '—' : `${f.volumeToLiquidity.toFixed(2)}×`}
            hint="Very high means the pool is being churned; very low means almost nobody trades it."
          />
        </dl>
      </Panel>

      <Panel title="Contract screen">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
          <Metric label="Largest holder" value={f.topHolderPct === null ? '—' : `${(f.topHolderPct * 100).toFixed(1)}%`} />
          <Metric label="LP locked" value={yesNo(f.lpLocked)} />
          <Metric label="Mint revoked" value={yesNo(f.mintAuthorityRevoked)} />
          <Metric label="Freeze revoked" value={yesNo(f.freezeAuthorityRevoked)} />
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
        <Panel title="Other pools for this token">
          <ul className="space-y-1 text-xs text-slate-400">
            {result.otherPools.map((p, i) => (
              <li key={i}>
                {p.chainId} · {p.dexId} — {p.liquidityUsd === null ? 'liquidity unknown' : formatUsd(p.liquidityUsd)}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <UnknownsPanel
        title="Could not be read"
        items={f.unknowns}
        note="The technical readings (RSI, EMA, support/resistance) need candle history, which the free DEX source does not return — so that half is left empty rather than approximated from a handful of percentage changes."
      />
    </div>
  );
}

function TechnicalPanel({ read }: { read: LookupTechnical }) {
  return (
    <Panel title="Technical">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
        <Metric label="Price" value={formatTokenPrice(read.lastPrice)} />
        <Metric label="RSI 14" value={read.rsi14 === null ? '—' : read.rsi14.toFixed(1)} />
        <Metric
          label="Trend"
          value={read.trend === null ? '—' : trendLabel(read.trend.direction)}
          hint={read.trend === null ? undefined : `EMA20 vs EMA50: ${read.trend.separationPct.toFixed(2)}%`}
        />
        <Metric label="Range (ATR)" value={read.atrPct === null ? '—' : `${read.atrPct.toFixed(2)}%`} />
        <Metric label="Nearest low" value={read.support === null ? '—' : formatTokenPrice(read.support)} />
        <Metric label="Nearest high" value={read.resistance === null ? '—' : formatTokenPrice(read.resistance)} />
        <Metric
          label="Range position"
          value={read.rangePositionPct === null ? '—' : `${read.rangePositionPct.toFixed(0)}/100`}
          hint="0 is the bottom of the window's range, 100 the top."
        />
        <Metric
          label="Change over 24 bars"
          value={read.changePct.last24Bars === null ? '—' : `${read.changePct.last24Bars >= 0 ? '+' : ''}${read.changePct.last24Bars.toFixed(2)}%`}
        />
      </dl>
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        This <span className="font-semibold text-slate-400">describes</span> where price sits relative to its own
        recent history. It is not a forecast: this system has no recorded outcomes behind any of these readings, so
        it does not say what to do about them.
      </p>
      {read.missing.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-300/80">
          Not enough history for: {read.missing.join(' · ')}.
        </p>
      )}
    </Panel>
  );
}

function UnknownsPanel({ title, items, note }: { title: string; items: string[]; note: string }) {
  return (
    <Panel title={title}>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">Everything was readable.</p>
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

/** Three states, never two: "unknown" is not "no". */
function yesNo(value: boolean | null): string {
  if (value === null) return 'unknown';
  return value ? 'yes' : 'no';
}

function trendLabel(direction: 'up' | 'down' | 'sideways'): string {
  if (direction === 'up') return 'EMA20 > EMA50';
  if (direction === 'down') return 'EMA20 < EMA50';
  return 'flat';
}
