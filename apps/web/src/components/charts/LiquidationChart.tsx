'use client';

import { useMemo } from 'react';
import { ChartPanel } from './ChartPanel';
import { TimeSeriesChart } from './TimeSeriesChart';
import type { SymbolSeriesPoint } from '@/lib/types';
import { formatUsd } from '@/lib/format';

interface LiquidationChartProps {
  points: SymbolSeriesPoint[];
  height?: number;
}

/**
 * Chart 6/8: long vs short liquidations as a diverging bar chart — long
 * bars up (green), short bars negated down (red), sharing one baseline.
 */
export function LiquidationChart({ points, height = 180 }: LiquidationChartProps) {
  const series = useMemo(
    () => [
      {
        kind: 'histogram' as const,
        color: '#34d399',
        data: points.map((p) => ({ timestamp: p.timestamp, value: p.liquidationLongUsd })),
      },
      {
        kind: 'histogram' as const,
        color: '#fb7185',
        data: points.map((p) => ({ timestamp: p.timestamp, value: -p.liquidationShortUsd })),
      },
    ],
    [points],
  );

  const last = points.at(-1);

  return (
    <ChartPanel
      title="Liquidations"
      lastValue={
        last ? (
          <>
            <span className="text-emerald-400">L {formatUsd(last.liquidationLongUsd)}</span>
            {' / '}
            <span className="text-rose-400">S {formatUsd(last.liquidationShortUsd)}</span>
          </>
        ) : undefined
      }
    >
      <TimeSeriesChart series={series} height={height} />
    </ChartPanel>
  );
}
