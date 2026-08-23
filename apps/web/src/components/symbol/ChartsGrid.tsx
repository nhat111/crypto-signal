import { PriceChart } from '@/components/charts/PriceChart';
import { LiquidationChart } from '@/components/charts/LiquidationChart';
import { MetricChartCard } from '@/components/charts/MetricChartCard';
import type { Signal, SymbolSeriesPoint } from '@/lib/types';
import { formatPct, formatScore, formatSignedUsd, formatUsd } from '@/lib/format';

interface ChartsGridProps {
  points: SymbolSeriesPoint[];
  signals: Signal[];
}

/** The 8 required charts for the symbol detail page (spec §18 / API_CONTRACT.md "Charts required"). */
export function ChartsGrid({ points, signals }: ChartsGridProps) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div className="md:col-span-2 xl:col-span-3">
        <PriceChart points={points} signals={signals} height={260} />
      </div>

      <MetricChartCard
        title="Spot CVD"
        points={points}
        valueKey="spotCvdCumulative"
        color="#38bdf8"
        formatter={formatSignedUsd}
      />
      <MetricChartCard
        title="Futures CVD"
        points={points}
        valueKey="futuresCvdCumulative"
        color="#a78bfa"
        formatter={formatSignedUsd}
      />
      <MetricChartCard
        title="Open Interest"
        points={points}
        valueKey="openInterest"
        color="#facc15"
        formatter={(v) => formatUsd(v)}
      />

      <MetricChartCard
        title="Funding Rate"
        points={points}
        valueKey="fundingRatePct"
        color="#fb923c"
        formatter={(v) => formatPct(v, 3)}
      />
      <LiquidationChart points={points} />
      <MetricChartCard
        title="Health Score"
        points={points}
        valueKey="healthScore"
        color="#34d399"
        formatter={formatScore}
      />

      <MetricChartCard
        title="Risk Score"
        points={points}
        valueKey="riskScore"
        color="#f87171"
        formatter={formatScore}
      />
    </div>
  );
}
