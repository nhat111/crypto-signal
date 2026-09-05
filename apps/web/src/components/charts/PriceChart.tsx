'use client';

import { useMemo } from 'react';
import { ChartPanel } from './ChartPanel';
import { TimeSeriesChart, type ChartMarker } from './TimeSeriesChart';
import { SEVERITY_HEX, signalTypeLabel } from '@/lib/severity';
import type { Signal, SymbolSeriesPoint } from '@/lib/types';
import { formatUsd } from '@/lib/format';

interface PriceChartProps {
  points: SymbolSeriesPoint[];
  signals: Signal[];
  height?: number;
}

/** Chart 1/8 (spec §18): price with recent signals overlaid as markers, colored by severity. */
export function PriceChart({ points, signals, height = 220 }: PriceChartProps) {
  const data = useMemo(
    () => points.map((p) => ({ timestamp: p.timestamp, value: p.priceClose })),
    [points],
  );

  const markers = useMemo<ChartMarker[]>(
    () =>
      signals.map((s) => ({
        timestamp: s.timestamp,
        color: SEVERITY_HEX[s.severity],
        text: signalTypeLabel(s.signalType),
        position: 'aboveBar',
      })),
    [signals],
  );

  const last = points.at(-1);
  const series = useMemo(() => [{ kind: 'line' as const, color: '#38bdf8', lineWidth: 2 as const, data }], [data]);

  return (
    <ChartPanel title="Price" lastValue={last ? formatUsd(last.priceClose, false) : undefined}>
      <TimeSeriesChart series={series} markers={markers} height={height} />
    </ChartPanel>
  );
}
