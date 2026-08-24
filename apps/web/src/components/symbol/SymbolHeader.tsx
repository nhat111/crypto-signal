import { HealthBadge } from '@/components/HealthBadge';
import { RiskBadge } from '@/components/RiskBadge';
import type { PriceLevels, SymbolLatest } from '@/lib/types';
import { cx, formatPct, formatRelativeTime, formatUsd } from '@/lib/format';

interface SymbolHeaderProps {
  symbol: string;
  latest: SymbolLatest;
  priceLevels: PriceLevels | null;
}

export function SymbolHeader({ symbol, latest, priceLevels }: SymbolHeaderProps) {
  const priceUp = latest.priceChangePct >= 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">{symbol}</h1>
          <p className="text-xs text-slate-500">updated {formatRelativeTime(latest.timestamp)}</p>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-slate-100">
            {formatUsd(latest.priceClose, false)}
          </span>
          <span className={cx('text-sm font-semibold tabular-nums', priceUp ? 'text-emerald-400' : 'text-rose-400')}>
            {formatPct(latest.priceChangePct)}
          </span>
        </div>

        <HealthBadge score={latest.healthScore} status={latest.healthStatus} size="lg" />
        <RiskBadge score={latest.riskScore} size="lg" />

        <span className="text-xs text-slate-500">
          data quality {Math.round(latest.dataQualityScore)}%
        </span>
      </div>

      {priceLevels && <PriceLevelsRow levels={priceLevels} />}
    </div>
  );
}

/**
 * Reference range, not a signal — deliberately styled like a caption
 * (small, muted), never a badge or button, so it never reads as a
 * directive to act. The disclaimer is inline text, not a tooltip, so it's
 * never one interaction away from being missed.
 */
function PriceLevelsRow({ levels }: { levels: PriceLevels }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      <span>
        20-candle range: <span className="text-rose-400/80 tabular-nums">{formatUsd(levels.lower, false)}</span>
        {' – '}
        <span className="text-emerald-400/80 tabular-nums">{formatUsd(levels.upper, false)}</span>
        {' '}(mid <span className="tabular-nums">{formatUsd(levels.middle, false)}</span>)
      </span>
      <span className="text-slate-600">Bollinger 20,2 — reference only, not a buy/sell instruction.</span>
    </div>
  );
}
