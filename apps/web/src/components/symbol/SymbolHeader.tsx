import { HealthBadge } from '@/components/HealthBadge';
import { RiskBadge } from '@/components/RiskBadge';
import type { SymbolLatest } from '@/lib/types';
import { cx, formatPct, formatRelativeTime, formatUsd } from '@/lib/format';

interface SymbolHeaderProps {
  symbol: string;
  latest: SymbolLatest;
}

export function SymbolHeader({ symbol, latest }: SymbolHeaderProps) {
  const priceUp = latest.priceChangePct >= 0;

  return (
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
  );
}
