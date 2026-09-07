import type { LookupLevel, LookupResult, LookupTechnical, LookupTimeframeGlance } from '@/lib/types';
import { SafetyBadge } from '@/components/gems/SafetyBadge';
import { formatTokenPrice, formatUsd } from '@/lib/format';
import { apiPredatesReadings } from '@/lib/openPnl';
import { Glossary, ONCHAIN_GLOSSARY, TECHNICAL_GLOSSARY } from './Glossary';

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
        {result.timeframes && result.timeframes.length > 0 && (
          <TimeframePanel chosen={result.timeframe} glances={result.timeframes} />
        )}
        <LinkRow
          links={[
            result.fundamentals.exchangeUrl
              ? { label: `${result.symbol} on Binance`, url: result.fundamentals.exchangeUrl }
              : null,
          ]}
        />
        <Glossary title="What these readings mean" items={TECHNICAL_GLOSSARY} />
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

      <LinkRow
        links={[
          f.explorer ? { label: `Contract on ${f.explorer.name}`, url: f.explorer.url } : null,
          f.dexScreenerUrl ? { label: 'Pool on DexScreener', url: f.dexScreenerUrl } : null,
          ...(f.websites ?? []).map((w) => ({ label: w.label?.trim() || 'Project website', url: w.url })),
          ...(f.socials ?? []).map((x) => ({ label: x.type?.trim() || 'Social', url: x.url })),
        ]}
      />

      <Glossary title="What these figures mean" items={ONCHAIN_GLOSSARY} />

      <UnknownsPanel
        title="Could not be read"
        items={f.unknowns}
        note="The technical readings (RSI, EMA, support/resistance) need candle history, which the free DEX source does not return — so that half is left empty rather than approximated from a handful of percentage changes."
      />
    </div>
  );
}

/** An older API sent a bare number here; a newer one sends the level with its distance. */
function asLevel(value: LookupLevel | number | null | undefined): LookupLevel | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? { price: value, distancePct: 0 } : value;
}

function levelText(level: LookupLevel | null, missingNote: string): string {
  if (level === null) return missingNote;
  if (level.distancePct === 0) return formatTokenPrice(level.price);
  return `${formatTokenPrice(level.price)} · ${level.distancePct >= 0 ? '+' : ''}${level.distancePct.toFixed(1)}%`;
}

function TechnicalPanel({ read }: { read: LookupTechnical }) {
  const support = asLevel(read.support);
  const resistance = asLevel(read.resistance);
  return (
    <Panel title="Technical">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
        <Metric label="Price" value={formatTokenPrice(read.lastPrice)} />
        <Metric
          label="RSI 14"
          value={read.rsi14 === null ? '—' : read.rsi14.toFixed(1)}
          sub={pct(read.rsi14Percentile, 'higher than {v} of window')}
        />
        <Metric
          label="Trend"
          value={read.trend === null ? '—' : trendLabel(read.trend.direction)}
          sub={read.trend === null ? undefined : `EMA gap ${read.trend.separationPct.toFixed(2)}%`}
        />
        <Metric
          label="Range (ATR)"
          value={read.atrPct === null ? '—' : `${read.atrPct.toFixed(2)}%`}
          sub={pct(read.atrPctPercentile, 'wider than {v} of window')}
        />
        <Metric
          label="Nearest low"
          value={levelText(support, read.belowAllSwingLows ? 'below all' : '—')}
          hint="Nearest swing low below price, and how far away it is."
        />
        <Metric
          label="Nearest high"
          value={levelText(resistance, read.aboveAllSwingHighs ? 'cleared all' : '—')}
          hint="Nearest swing high above price. 'cleared all' means price is above every swing high in the window — not missing data."
        />
        <Metric
          label="Range position"
          value={read.rangePositionPct === null ? '—' : `${read.rangePositionPct.toFixed(0)}/100`}
          sub={
            read.windowLow && read.windowHigh
              ? `${formatTokenPrice(read.windowLow.price)} – ${formatTokenPrice(read.windowHigh.price)}`
              : undefined
          }
          hint="0 is the bottom of the window's range, 100 the top."
        />
        <Metric
          label="Volume vs avg"
          value={read.volumeRatio === null || read.volumeRatio === undefined ? '—' : `${read.volumeRatio.toFixed(2)}×`}
          hint="Latest bar's volume against the 20 before it. 1× is ordinary."
        />
        <Metric
          label="Window high"
          value={read.windowHigh ? `${read.windowHigh.distancePct >= 0 ? '+' : ''}${read.windowHigh.distancePct.toFixed(1)}%` : '—'}
          sub={read.windowHigh ? `${read.windowHigh.barsAgo} bars ago` : undefined}
        />
        <Metric
          label="Window low"
          value={read.windowLow ? `${read.windowLow.distancePct.toFixed(1)}%` : '—'}
          sub={read.windowLow ? `${read.windowLow.barsAgo} bars ago` : undefined}
        />
        <Metric
          label="Change over 24 bars"
          value={read.changePct.last24Bars === null ? '—' : `${read.changePct.last24Bars >= 0 ? '+' : ''}${read.changePct.last24Bars.toFixed(2)}%`}
        />
        <Metric
          label="Change over 7 bars"
          value={read.changePct.last7Bars === null ? '—' : `${read.changePct.last7Bars >= 0 ? '+' : ''}${read.changePct.last7Bars.toFixed(2)}%`}
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
      {/* Without this, a deploy still in flight looks like a broken token:
          the API and the web ship separately, and for a few minutes the
          newer fields simply are not in the response. */}
      {apiPredatesReadings(read) && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-300/80">
          Some readings are blank because the API answering this page is older than the page itself — a deploy still
          catching up, not a problem with this symbol. Check the service commits on Status.
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

/**
 * Somewhere to go and check.
 *
 * Rendered as buttons rather than inline text because they are the main
 * reason to leave this page, and on a phone a 16px text link is not a
 * target. Externals get rel="noreferrer": these URLs come from a token's
 * own submission to a third party and are not ours to vouch for.
 */
function LinkRow({ links }: { links: Array<{ label: string; url: string } | null> }) {
  const present = links.filter((l): l is { label: string; url: string } => l !== null);
  if (present.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {present.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-[40px] items-center rounded-md border border-slate-700 px-3 text-xs font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
        >
          {l.label} →
        </a>
      ))}
    </div>
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

function Metric({ label, value, hint, sub }: { label: string; value: string; hint?: string; sub?: string }) {
  return (
    <div className="rounded-md border border-slate-800/70 bg-slate-950/40 px-2 py-1.5" title={hint}>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="tabular-nums text-slate-200">{value}</dd>
      {/* The context line is what stops a number being generic: 75.7 says
          nothing until you know this thing rarely goes above 60. */}
      {sub && <dd className="text-[10px] leading-tight text-slate-500">{sub}</dd>}
    </div>
  );
}

function pct(value: number | null | undefined, template: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return template.replace('{v}', `${value.toFixed(0)}%`);
}

/**
 * Whether the frames agree.
 *
 * One frame in isolation is the most generic thing a chart can say. Two
 * frames pointing opposite ways is a specific, checkable fact — and it is
 * usually the half that changes a decision.
 */
function TimeframePanel({ chosen, glances }: { chosen: string; glances: LookupTimeframeGlance[] }) {
  return (
    <Panel title="Other timeframes">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
        {glances.map((g) => (
          <Metric
            key={g.timeframe}
            label={g.timeframe}
            value={g.trend === null ? '—' : trendLabel(g.trend.direction)}
            sub={[
              g.rsi14 === null ? null : `RSI ${g.rsi14.toFixed(0)}`,
              g.changePct === null ? null : `${g.changePct >= 0 ? '+' : ''}${g.changePct.toFixed(1)}% / 24 bars`,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        Shown beside <span className="font-semibold text-slate-400">{chosen}</span> because one frame on its own
        cannot say whether the frames agree — and when they disagree, that is usually the more useful fact.
      </p>
    </Panel>
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
