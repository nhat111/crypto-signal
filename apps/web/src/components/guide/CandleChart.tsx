import type { ReactNode } from 'react';

/**
 * A hand-drawn candlestick figure for the TA guide.
 *
 * Not a data visualisation — there is no dataset behind it. Each figure is
 * a worked example whose candles are chosen to show one thing, and the
 * numbers are the same ones the table beside it lists, so the table is the
 * chart's readable twin rather than an extra.
 *
 * Two rules it must not break:
 *
 *  * Nothing is encoded by colour alone. Up candles are hollow and down
 *    candles filled, so direction survives red-green colour blindness and
 *    a black-and-white print; every price line carries its own text label
 *    rather than relying on a legend.
 *  * Every figure stops at the setup, never at the outcome. Drawing what
 *    the price did next would teach hindsight: in real time the reader is
 *    standing at the last candle with the entry not yet filled.
 */

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface Zone {
  from: number;
  to: number;
  label: string;
  tone: 'support' | 'resistance';
}

export interface Level {
  price: number;
  label: string;
  tone: 'entry' | 'stop' | 'target';
}

/** A line drawn in price space over the candles — a moving average. */
export interface Overlay {
  /** One value per candle; null where the average does not exist yet. */
  values: Array<number | null>;
  label: string;
  tone: 'fast' | 'slow';
}

/** A sub-plot under the price chart, on its own scale (RSI 0-100, ATR in price units). */
export interface Pane {
  title: string;
  values: Array<number | null>;
  domain: [number, number];
  /** Shaded rows worth naming, e.g. RSI 40-50. */
  bands?: Array<{ from: number; to: number; label: string }>;
  /** Horizontal reference lines, e.g. RSI 70. */
  lines?: Array<{ at: number; label: string }>;
}

export interface Marker {
  /** 0-based candle index the note points at. */
  index: number;
  label: string;
  place: 'above' | 'below';
}

interface Props {
  caption: string;
  candles: Candle[];
  domain: [number, number];
  zones?: Zone[];
  levels?: Level[];
  markers?: Marker[];
  /** Optional volume row. Same length as `candles`; the tallest bar is highlighted. */
  volumes?: number[];
  /** Index of the volume bar worth pointing at, if any. */
  volumeHighlight?: number;
  overlays?: Overlay[];
  pane?: Pane;
}

const W = 560;
const PAD_L = 8;
/** Reserved for the right-hand price labels — collapsed when a figure has none, or the plot sits squashed against a void. */
const PAD_R_LABELLED = 104;
const PAD_R_BARE = 12;
const PAD_T = 22;
const PLOT_H = 200;
const VOL_H = 34;
const PANE_H = 76;

const OVERLAY_COLOR = { fast: '#38bdf8', slow: '#c084fc' } as const;

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

const ZONE_STYLE = {
  support: { fill: 'rgb(16 185 129 / 0.10)', stroke: 'rgb(16 185 129 / 0.35)', text: '#6ee7b7' },
  resistance: { fill: 'rgb(244 63 94 / 0.09)', stroke: 'rgb(244 63 94 / 0.32)', text: '#fda4af' },
} as const;

const LEVEL_STYLE = {
  entry: { color: '#7dd3fc', label: 'Vào' },
  stop: { color: '#fb7185', label: 'Cắt' },
  target: { color: '#34d399', label: 'Chốt' },
} as const;

export function CandleChart({
  caption,
  candles,
  domain,
  zones = [],
  levels = [],
  markers = [],
  volumes,
  volumeHighlight,
  overlays = [],
  pane,
}: Props) {
  const [lo, hi] = domain;
  const height = PAD_T + PLOT_H + (volumes ? VOL_H + 10 : 0) + (pane ? PANE_H + 18 : 0) + 14;
  const padR = levels.length > 0 || volumes || overlays.length > 0 || pane ? PAD_R_LABELLED : PAD_R_BARE;
  const plotW = W - PAD_L - padR;
  const step = plotW / candles.length;
  const bodyW = Math.min(step * 0.58, 15);

  const y = (price: number): number => PAD_T + PLOT_H - ((price - lo) / (hi - lo)) * PLOT_H;
  const cx = (i: number): number => PAD_L + step * (i + 0.5);

  const volTop = PAD_T + PLOT_H + 10;
  const volMax = volumes ? Math.max(...volumes) : 1;
  const paneTop = PAD_T + PLOT_H + 18;
  const paneY = (value: number): number =>
    pane ? paneTop + PANE_H - ((value - pane.domain[0]) / (pane.domain[1] - pane.domain[0])) * PANE_H : 0;

  /** Broken into runs so a gap of nulls leaves a gap, not a straight line across it. */
  const runs = (values: Array<number | null>, toY: (v: number) => number): string[] =>
    values
      .reduce<Array<Array<[number, number]>>>((acc, value, i) => {
        if (value === null) {
          if (acc.length > 0 && (acc[acc.length - 1] as Array<[number, number]>).length > 0) acc.push([]);
          return acc;
        }
        if (acc.length === 0) acc.push([]);
        (acc[acc.length - 1] as Array<[number, number]>).push([cx(i), toY(value)]);
        return acc;
      }, [])
      .filter((run) => run.length > 1)
      .map((run) => run.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(' '));

  return (
    <figure className="my-1">
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="h-auto w-full min-w-[33rem]"
          role="img"
          aria-label={caption}
        >
          {zones.map((zone) => {
            const style = ZONE_STYLE[zone.tone];
            const top = y(zone.to);
            const h = y(zone.from) - top;
            return (
              <g key={`${zone.label}-${zone.from}`}>
                <rect x={PAD_L} y={top} width={plotW} height={h} fill={style.fill} />
                <line x1={PAD_L} x2={PAD_L + plotW} y1={top} y2={top} stroke={style.stroke} strokeWidth="1" />
                <line
                  x1={PAD_L}
                  x2={PAD_L + plotW}
                  y1={top + h}
                  y2={top + h}
                  stroke={style.stroke}
                  strokeWidth="1"
                />
                {/* Centred in the band, unless a threshold line runs through
                    that row — a level drawn inside its own zone is the whole
                    point of one figure here, and it struck the label out. */}
                <text
                  x={PAD_L + 5}
                  y={
                    levels.some((level) => Math.abs(y(level.price) - (top + h / 2)) < 8)
                      ? top - 5
                      : top + h / 2 + 3.5
                  }
                  fontSize="10"
                  fill={style.text}
                  fontWeight="600"
                >
                  {zone.label}
                </text>
              </g>
            );
          })}

          {candles.map((candle, i) => {
            const up = candle.c >= candle.o;
            const colour = up ? '#34d399' : '#fb7185';
            const bodyTop = y(Math.max(candle.o, candle.c));
            const bodyH = Math.max(y(Math.min(candle.o, candle.c)) - bodyTop, 1.5);
            return (
              <g key={i}>
                <line
                  x1={cx(i)}
                  x2={cx(i)}
                  y1={y(candle.h)}
                  y2={y(candle.l)}
                  stroke={colour}
                  strokeWidth="1.2"
                />
                {/* Hollow for up, filled for down: direction is readable without colour. */}
                <rect
                  x={cx(i) - bodyW / 2}
                  y={bodyTop}
                  width={bodyW}
                  height={bodyH}
                  fill={up ? '#020617' : colour}
                  stroke={colour}
                  strokeWidth="1.2"
                  rx="1"
                />
              </g>
            );
          })}

          {overlays.map((overlay) => {
            const colour = OVERLAY_COLOR[overlay.tone];
            const lastIndex = overlay.values.reduce<number>((last, v, i) => (v === null ? last : i), -1);
            return (
              <g key={overlay.label}>
                {runs(overlay.values, y).map((points, i) => (
                  <polyline key={i} points={points} fill="none" stroke={colour} strokeWidth="1.6" />
                ))}
                {lastIndex >= 0 && (
                  <text
                    x={PAD_L + plotW + 7}
                    y={y(overlay.values[lastIndex] as number) + 3.5}
                    fontSize="10"
                    fill={colour}
                    fontWeight="700"
                  >
                    {overlay.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Dashed deliberately: these are thresholds, not gridlines. There
              are no gridlines here at all — every number the reader needs is
              on a labelled line or in the table below. */}
          {levels.map((level) => {
            const style = LEVEL_STYLE[level.tone];
            const ly = y(level.price);
            return (
              <g key={level.label}>
                <line
                  x1={PAD_L}
                  x2={PAD_L + plotW}
                  y1={ly}
                  y2={ly}
                  stroke={style.color}
                  strokeWidth="1.3"
                  strokeDasharray="5 4"
                />
                <text x={PAD_L + plotW + 7} y={ly + 3.5} fontSize="10.5" fill={style.color} fontWeight="700">
                  {level.label}
                </text>
              </g>
            );
          })}

          {/* A note is useless if the reader cannot tell which candle it
              belongs to, so each one keeps a centred anchor, gets clamped
              inside the plot rather than overhanging it, and draws a leader
              down to its candle. Earlier these were end-anchored near the
              right edge, which ran the text back across four other candles. */}
          {markers.map((marker) => {
            const candle = candles[marker.index] as Candle;
            const above = marker.place === 'above';
            // Cleared against the neighbouring candles, not just its own: a
            // note under a candle in a falling run lands on top of the next
            // three. The leader still points at the candle it belongs to.
            const near = candles.slice(Math.max(0, marker.index - 3), marker.index + 4);
            const tip = above
              ? Math.min(y(candle.h), ...near.map((n) => y(n.h))) - 4
              : Math.max(y(candle.l), ...near.map((n) => y(n.l))) + 4;
            // Nudge the note clear of any threshold line it would land on:
            // a note sitting on top of the dashed "Cắt 58,5" reads as part
            // of that label rather than as a note about a candle.
            let textY = above ? tip - 14 : tip + 17;
            for (let guard = 0; guard < 6; guard += 1) {
              if (!levels.some((level) => Math.abs(y(level.price) - textY) < 9)) break;
              textY += above ? -10 : 10;
            }
            const halfW = marker.label.length * 2.6;
            const x = clamp(cx(marker.index), PAD_L + halfW + 2, PAD_L + plotW - halfW - 2);
            return (
              <g key={marker.label}>
                <line
                  x1={cx(marker.index)}
                  x2={x}
                  y1={tip}
                  y2={above ? textY + 3 : textY - 9}
                  stroke="#64748b"
                  strokeWidth="0.9"
                />
                <text x={x} y={textY} fontSize="9.5" fill="#cbd5e1" textAnchor="middle" fontWeight="600">
                  {marker.label}
                </text>
              </g>
            );
          })}

          {volumes?.map((volume, i) => {
            const h = Math.max((volume / volMax) * VOL_H, 1);
            const hot = i === volumeHighlight;
            return (
              <rect
                key={i}
                x={cx(i) - bodyW / 2}
                y={volTop + VOL_H - h}
                width={bodyW}
                height={h}
                fill={hot ? '#38bdf8' : '#334155'}
                rx="1"
              />
            );
          })}
          {volumes && (
            <text x={PAD_L + plotW + 7} y={volTop + VOL_H} fontSize="9.5" fill="#64748b" fontWeight="600">
              Khối lượng
            </text>
          )}

          {pane && (
            <g>
              <rect x={PAD_L} y={paneTop} width={plotW} height={PANE_H} fill="#0b1220" rx="2" />
              {pane.bands?.map((band) => (
                <g key={band.label}>
                  <rect
                    x={PAD_L}
                    y={paneY(band.to)}
                    width={plotW}
                    height={paneY(band.from) - paneY(band.to)}
                    fill="rgb(16 185 129 / 0.12)"
                  />
                  <text x={PAD_L + 5} y={paneY(band.to) - 3} fontSize="9" fill="#6ee7b7" fontWeight="600">
                    {band.label}
                  </text>
                </g>
              ))}
              {pane.lines?.map((line) => (
                <g key={line.label}>
                  <line
                    x1={PAD_L}
                    x2={PAD_L + plotW}
                    y1={paneY(line.at)}
                    y2={paneY(line.at)}
                    stroke="#fb7185"
                    strokeWidth="1.1"
                    strokeDasharray="4 4"
                  />
                  <text x={PAD_L + plotW + 7} y={paneY(line.at) + 3.5} fontSize="9.5" fill="#fb7185" fontWeight="700">
                    {line.label}
                  </text>
                </g>
              ))}
              {runs(pane.values, paneY).map((points, i) => (
                <polyline key={i} points={points} fill="none" stroke="#e2e8f0" strokeWidth="1.6" />
              ))}
              <text x={PAD_L + 5} y={paneTop - 5} fontSize="9.5" fill="#94a3b8" fontWeight="700">
                {pane.title}
              </text>
            </g>
          )}
        </svg>
      </div>
      <figcaption className="mt-1.5 text-xs leading-relaxed text-slate-500">{caption}</figcaption>
    </figure>
  );
}

/** Shared legend, shown once so every figure below can stay unlabelled. */
export function CandleLegend(): ReactNode {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cách đọc hình</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
        <span className="flex items-center gap-2">
          <svg width="14" height="26" viewBox="0 0 14 26" aria-hidden="true">
            <line x1="7" x2="7" y1="1" y2="25" stroke="#34d399" strokeWidth="1.4" />
            <rect x="2" y="7" width="10" height="12" fill="#020617" stroke="#34d399" strokeWidth="1.4" rx="1" />
          </svg>
          Nến rỗng = phiên tăng
        </span>
        <span className="flex items-center gap-2">
          <svg width="14" height="26" viewBox="0 0 14 26" aria-hidden="true">
            <line x1="7" x2="7" y1="1" y2="25" stroke="#fb7185" strokeWidth="1.4" />
            <rect x="2" y="7" width="10" height="12" fill="#fb7185" stroke="#fb7185" strokeWidth="1.4" rx="1" />
          </svg>
          Nến đặc = phiên giảm
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm border border-emerald-500/40 bg-emerald-500/15" />
          Vùng hỗ trợ
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm border border-rose-500/40 bg-rose-500/15" />
          Vùng kháng cự
        </span>
        <span className="flex items-center gap-2">
          <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true">
            <line x1="0" x2="22" y1="3" y2="3" stroke="#7dd3fc" strokeWidth="1.6" strokeDasharray="5 4" />
          </svg>
          Mức giá đã lên kế hoạch
        </span>
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
        Mỗi cây nến gói trọn <span className="font-semibold text-slate-400">một khoảng thời gian</span>: trên khung
        4H là 4 tiếng, trên khung 1D là một ngày. Thân nến là giá mở và giá đóng của khoảng đó; râu nến là giá cao
        nhất và thấp nhất chạm tới bên trong nó. Mọi hình đều dừng lại{' '}
        <span className="font-semibold text-slate-400">ngay tại điểm ra quyết định</span> — không vẽ tiếp giá sau đó,
        vì lúc thật bro cũng không được nhìn thấy phần đó.
      </p>
    </div>
  );
}
