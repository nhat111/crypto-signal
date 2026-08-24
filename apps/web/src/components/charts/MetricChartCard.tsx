'use client';

import { useMemo } from 'react';
import { ChartPanel } from './ChartPanel';
import { TimeSeriesChart } from './TimeSeriesChart';
import type { SymbolSeriesPoint } from '@/lib/types';
import { cx } from '@/lib/format';

type NumericKey = Exclude<keyof SymbolSeriesPoint, 'timestamp'>;

interface MetricChartCardProps {
  title: string;
  points: SymbolSeriesPoint[];
  valueKey: NumericKey;
  color: string;
  formatter: (value: number) => string;
  lastValueClassName?: string;
  height?: number;
}

/** Shared single-line chart card for Spot CVD, Futures CVD, OI, Funding, Health, and Risk (charts 2,3,4,5,7,8 of 8). */
export function MetricChartCard({
  title,
  points,
  valueKey,
  color,
  formatter,
  lastValueClassName,
  height = 180,
}: MetricChartCardProps) {
  const data = useMemo(
    () =>
      points
        .filter((p): p is typeof p & Record<NumericKey, number> => p[valueKey] !== null)
        .map((p) => ({ timestamp: p.timestamp, value: p[valueKey] })),
    [points, valueKey],
  );
  const series = useMemo(() => [{ kind: 'line' as const, color, lineWidth: 2 as const, data }], [color, data]);
  const last = points.at(-1);
  const lastValue = last ? last[valueKey] : undefined;

  return (
    <ChartPanel
      title={title}
      lastValue={lastValue != null ? formatter(lastValue) : 'N/A'}
      lastValueClassName={cx('text-sm font-bold tabular-nums', lastValueClassName)}
    >
      <TimeSeriesChart series={series} height={height} />
    </ChartPanel>
  );
}
