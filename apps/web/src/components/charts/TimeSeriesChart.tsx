'use client';

import { useEffect, useRef } from 'react';
import {
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type UTCTimestamp,
} from 'lightweight-charts';

export interface ChartSeriesConfig {
  kind: 'line' | 'histogram';
  color: string;
  lineWidth?: 1 | 2 | 3 | 4;
  data: { timestamp: number; value: number }[];
}

export interface ChartMarker {
  timestamp: number;
  color: string;
  text: string;
  position: 'aboveBar' | 'belowBar';
  shape?: 'circle' | 'arrowUp' | 'arrowDown' | 'square';
}

interface TimeSeriesChartProps {
  series: ChartSeriesConfig[];
  /** Attached to the first series in `series` (only makes sense with a single line series, e.g. price). */
  markers?: ChartMarker[];
  height?: number;
}

/** A created series, narrowed to the one method this component actually needs. */
interface SimpleSeriesHandle {
  setData(data: { time: UTCTimestamp; value: number }[]): void;
}

const toUtc = (timestampMs: number): UTCTimestamp => Math.floor(timestampMs / 1000) as UTCTimestamp;

/**
 * Thin wrapper over lightweight-charts (spec §26). Chart + series are
 * created once on mount so zoom/pan state survives a poll; each poll only
 * calls setData on the existing series (cheap, no flicker).
 */
export function TimeSeriesChart({ series, markers, height = 200 }: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesHandlesRef = useRef<SimpleSeriesHandle[]>([]);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: { borderColor: '#1e293b' },
      timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const handles: SimpleSeriesHandle[] = [];
    let firstLine: ISeriesApi<'Line'> | null = null;

    for (const cfg of series) {
      if (cfg.kind === 'line') {
        const s = chart.addSeries(LineSeries, {
          color: cfg.color,
          lineWidth: cfg.lineWidth ?? 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        if (!firstLine) firstLine = s;
        handles.push(s as unknown as SimpleSeriesHandle);
      } else {
        const s = chart.addSeries(HistogramSeries, {
          color: cfg.color,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        handles.push(s as unknown as SimpleSeriesHandle);
      }
    }
    seriesHandlesRef.current = handles;

    if (firstLine) {
      markersPluginRef.current = createSeriesMarkers(firstLine, []);
    }

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesHandlesRef.current = [];
      markersPluginRef.current = null;
    };
    // Series kinds/colors are fixed per chart instance — only data changes below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  useEffect(() => {
    series.forEach((cfg, i) => {
      seriesHandlesRef.current[i]?.setData(
        cfg.data.map((p) => ({ time: toUtc(p.timestamp), value: p.value })),
      );
    });
    chartRef.current?.timeScale().fitContent();
  }, [series]);

  useEffect(() => {
    markersPluginRef.current?.setMarkers(
      (markers ?? []).map((m) => ({
        time: toUtc(m.timestamp),
        color: m.color,
        text: m.text,
        position: m.position,
        shape: m.shape ?? 'circle',
      })),
    );
  }, [markers]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
