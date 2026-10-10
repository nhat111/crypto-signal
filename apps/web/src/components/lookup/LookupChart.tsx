'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { LookupBar } from '@/lib/types';
import { emaSeries } from '@/lib/lookupChart';

const UP = '#34d399';
const DOWN = '#fb7185';
const EMA20 = '#38bdf8';
const EMA50 = '#f59e0b';

interface LookupChartProps {
  bars: LookupBar[];
  support: number | null;
  resistance: number | null;
  height?: number;
}

const toUtc = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

/** Enough decimals that a sub-cent coin does not draw as a flat line at 0.00. */
function precisionFor(price: number): number {
  if (price >= 100) return 2;
  if (price >= 1) return 3;
  if (price >= 0.1) return 4;
  if (price >= 0.001) return 6;
  return 8;
}

/**
 * The bars the Lookup read was computed from, drawn: candles, volume, the
 * EMA20/50 behind the trend line, and the support/resistance it names.
 *
 * Built once per result rather than updated in place — a lookup is a
 * one-off answer, not a feed, so there is no zoom state worth keeping
 * across a new query.
 */
export function LookupChart({ bars, support, resistance, height = 320 }: LookupChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closes = useMemo(() => bars.map((b) => b.close), [bars]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    const last = bars[bars.length - 1]!;
    const precision = precisionFor(last.close);
    const priceFormat = { type: 'price' as const, precision, minMove: 1 / 10 ** precision };

    const chart = createChart(container, {
      autoSize: true,
      height,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#1e293b', scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceFormat,
    });
    candles.setData(
      bars.map((b) => ({ time: toUtc(b.openTime), open: b.open, high: b.high, low: b.low, close: b.close })),
    );

    // Volume on its own overlay scale, squeezed into the bottom fifth.
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: '',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(
      bars.map((b) => ({
        time: toUtc(b.openTime),
        value: b.volume,
        color: b.close >= b.open ? `${UP}55` : `${DOWN}55`,
      })),
    );

    for (const [period, color] of [
      [20, EMA20],
      [50, EMA50],
    ] as const) {
      const points = emaSeries(closes, period);
      if (points.length === 0) continue;
      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      });
      line.setData(points.map((p) => ({ time: toUtc(bars[p.index]!.openTime), value: p.value })));
    }

    if (support !== null) {
      candles.createPriceLine({ price: support, color: UP, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Hỗ trợ' });
    }
    if (resistance !== null) {
      candles.createPriceLine({ price: resistance, color: DOWN, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Kháng cự' });
    }

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, closes, support, resistance, height]);

  if (bars.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <LegendSwatch color={EMA20} label="EMA20" />
        <LegendSwatch color={EMA50} label="EMA50" />
        {support !== null && <LegendSwatch color={UP} label="Hỗ trợ" dashed />}
        {resistance !== null && <LegendSwatch color={DOWN} label="Kháng cự" dashed />}
        <span className="ml-auto text-slate-600">Giờ UTC</span>
      </div>
      <div ref={containerRef} className="w-full" style={{ height }} />
    </div>
  );
}

function LegendSwatch({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-4" style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
      {label}
    </span>
  );
}
