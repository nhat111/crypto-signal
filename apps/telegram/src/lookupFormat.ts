import type { LookupDTO } from './apiClient.js';
import { FLOW_LABEL } from './coinsFormat.js';
import { escapeHtml, lookupChartUrl } from './formatting.js';
import { SECTOR_LABEL_TEXT } from './sectorsFormat.js';

/**
 * A lookup, in chat.
 *
 * Same rule as the page: this describes where price sits, who has been
 * moving it and what the contract allows, and never says what to do
 * about it. The chart read is computed on the spot; everything under it
 * is what the worker already stored about the coin (coin scan, sectors,
 * flywheel), so the reader is not sent to three other commands to find
 * out whether the move is real money.
 */

/** The API sends `{ price, distancePct }`; interpolating it whole printed "[object Object]". */
function levelText(level: number | { price: number; distancePct: number } | null): string {
  if (level === null) return '—';
  if (typeof level === 'number') return String(level);
  const sign = level.distancePct > 0 ? '+' : '';
  return `${level.price} (${sign}${level.distancePct.toFixed(1)}%)`;
}

const signed = (n: number | null | undefined, digits = 1): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;

const TREND_ICON: Record<string, string> = { up: '🟢', down: '🔴', sideways: '⚪' };

function trendText(trend: { direction: string; separationPct: number } | null): string {
  if (!trend) return 'chưa đủ nến';
  if (trend.direction === 'up') return `🟢 EMA20 trên EMA50 (${signed(trend.separationPct, 2)})`;
  if (trend.direction === 'down') return `🔴 EMA20 dưới EMA50 (${signed(-Math.abs(trend.separationPct), 2)})`;
  return '⚪ EMA20 ≈ EMA50: đi ngang';
}

function rsiText(rsi: number): string {
  const zone = rsi >= 70 ? 'vùng quá mua' : rsi <= 30 ? 'vùng quá bán' : 'trung tính';
  return `${rsi.toFixed(1)} (${zone})`;
}

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
}

const dayVi = (day: string): string => day.split('-').reverse().slice(0, 2).join('/');

function contextLines(data: LookupDTO, base: string): string[] {
  const ctx = data.context;
  // An API older than this field sends none: say nothing rather than "not in the scan".
  if (ctx === undefined || ctx === null) return [];
  const lines: string[] = [];

  const c = ctx.coinScan;
  if (c) {
    lines.push('', `💧 <b>Dòng tiền 7 ngày</b> (quét ${dayVi(c.day)})`, FLOW_LABEL[c.flow] ?? c.flow);
    lines.push(`Giá 7N ${signed(c.ret7d)} · 30N ${signed(c.ret30d)}`);
    if (base !== 'BTC') lines.push(`So với BTC: 7N ${signed(c.rs7d)} · 30N ${signed(c.rs30d)}`);
    // The scan's first reason restates the 7-day return printed just above.
    for (const r of c.reasons.filter((x) => !x.startsWith('Giá 7 ngày'))) lines.push(`• ${escapeHtml(r)}`);
    const f = c.fundamentals;
    if (f && (f.bull.length > 0 || f.bear.length > 0)) {
      for (const b of f.bull) lines.push(`▲ ${escapeHtml(b)}`);
      for (const b of f.bear) lines.push(`▼ ${escapeHtml(b)}`);
    }
    const unknowns = [...c.unknowns, ...(f?.unknowns ?? [])];
    if (unknowns.length > 0) lines.push(`<i>Không đọc được: ${escapeHtml(unknowns.join(' '))}</i>`);
  } else if (ctx.coinScanDay) {
    lines.push(
      '',
      `💧 <b>Dòng tiền:</b> ${escapeHtml(base)} không nằm trong top ${ctx.coinScanSize} coin quét ngày ${dayVi(ctx.coinScanDay)}, nên chưa có dữ liệu spot hay đòn bẩy. Xem các coin được quét: /coins`,
    );
  }

  if (ctx.sectors.length > 0) {
    const parts = ctx.sectors.map((s) => `${escapeHtml(s.name)} (#${s.rank}, ${SECTOR_LABEL_TEXT[s.label]})`);
    lines.push('', `🧭 <b>Dẫn đầu mảng:</b> ${parts.join(' · ')}`);
  }

  const fw = ctx.flywheel;
  if (fw) {
    const bits = [`${usd(fw.holdersRevenue30dUsd)} về holder / 30 ngày`];
    if (fw.holdersRevenueChangePct !== null) bits.push(`${signed(fw.holdersRevenueChangePct, 0)} so tháng trước`);
    if (fw.yieldPct !== null) bits.push(`${fw.yieldPct.toFixed(1)}%/năm vốn hoá`);
    lines.push('', `🔁 <b>Flywheel:</b> ${bits.join(' · ')}`);
  }
  return lines;
}

export function formatLookup(data: LookupDTO, webBaseUrl = ''): string {
  const lines: string[] = [];

  if (data.result.kind === 'exchange') {
    const { symbol, technical: t } = data.result;
    const base = symbol.replace(/(FDUSD|USDT|USDC|BUSD|BTC)$/, '') || symbol;
    const fromFallback = data.result.source !== undefined && data.result.source !== 'binance';
    const source = fromFallback ? (data.result.source ?? '').toUpperCase() : 'Binance';
    lines.push(`🔎 <b>${escapeHtml(symbol)}</b> · ${escapeHtml(source)} · khung ${escapeHtml(data.result.timeframe)}`);
    if (fromFallback) lines.push(`<i>Binance đang chặn máy chủ, nên nến lấy từ ${escapeHtml(source)}.</i>`);
    lines.push(`Giá ${t.lastPrice}`);

    lines.push('', `📊 <b>Kỹ thuật</b> (${escapeHtml(data.result.timeframe)})`);
    lines.push(`Cấu trúc: ${trendText(t.trend)}`);
    if (t.rsi14 !== null) lines.push(`RSI 14: ${rsiText(t.rsi14)}`);
    if (t.atrPct !== null) lines.push(`Biến động mỗi nến (ATR): ${t.atrPct.toFixed(2)}%`);
    if (t.support !== null || t.resistance !== null) {
      lines.push(`Đáy / đỉnh gần: ${levelText(t.support)} / ${levelText(t.resistance)}`);
    }
    if (t.rangePositionPct !== null) lines.push(`Vị trí trong biên độ ${t.barCount} nến: ${t.rangePositionPct.toFixed(0)}/100`);
    const glances = data.result.timeframes ?? [];
    if (glances.length > 0) {
      const parts = glances.map((g) => `${escapeHtml(g.timeframe)} ${g.trend ? (TREND_ICON[g.trend.direction] ?? '⚪') : '·'} ${signed(g.changePct)}`);
      lines.push(`Khung khác: ${parts.join(' · ')}`);
    }
    if (t.missing.length > 0) lines.push(`<i>Chưa đủ nến để tính: ${escapeHtml(t.missing.join(', '))}</i>`);

    const d = data.result.daily;
    if (d) {
      const trendVi = d.trend === 'up' ? '🟢 tăng' : d.trend === 'down' ? '🔴 giảm' : '⚪ đi ngang';
      const ema = d.aboveEma === null ? '' : ` · ${d.aboveEma ? 'trên' : 'dưới'} EMA${d.emaPeriod}`;
      lines.push('', `🎯 <b>Mức 1D bộ setup canh</b> (cấu trúc ${trendVi}${ema})`);
      lines.push(`Đáy 1D: ${d.swingLow ? levelText(d.swingLow) : '—'} · Đỉnh 1D: ${d.swingHigh ? levelText(d.swingHigh) : '—'}`);
      for (const w of d.watch) lines.push(`• ${escapeHtml(w)}`);
    }

    lines.push(...contextLines(data, base.toUpperCase()));

    const chartUrl = lookupChartUrl(webBaseUrl, symbol, data.result.timeframe);
    if (chartUrl) lines.push('', `📈 <a href="${escapeHtml(chartUrl)}">Xem chart</a>`);
    lines.push('', '<i>Mô tả giá và dòng tiền đã qua, không phải lời khuyên mua bán.</i>');
    return lines.join('\n');
  }

  const f = data.result.fundamentals;
  lines.push(`🔎 <b>${escapeHtml(f.symbol)}</b> · ${escapeHtml(f.name)}`);
  lines.push(`${escapeHtml(f.chainId)} · ${escapeHtml(f.dexId)}`);
  if (f.priceUsd !== null) lines.push(`Giá $${f.priceUsd}`);
  if (f.liquidityUsd !== null) lines.push(`Thanh khoản $${Math.round(f.liquidityUsd).toLocaleString('en-US')}`);
  if (f.fdvUsd !== null) lines.push(`FDV $${Math.round(f.fdvUsd).toLocaleString('en-US')}`);
  if (f.volume24hUsd !== null) lines.push(`Volume 24h $${Math.round(f.volume24hUsd).toLocaleString('en-US')}`);
  if (f.liquidityToFdvPct !== null) lines.push(`Thanh khoản/FDV: ${f.liquidityToFdvPct.toFixed(2)}%`);
  if (f.ageDays !== null) lines.push(`Tuổi pool: ${Math.floor(f.ageDays)} ngày`);
  lines.push(`Kiểm tra an toàn: ${f.safetyVerdict === null ? '❔ chưa có nguồn nào kiểm tra chain này' : f.safetyVerdict}`);
  if (f.topHolderPct !== null) lines.push(`Ví giữ nhiều nhất: ${(f.topHolderPct * 100).toFixed(1)}%`);
  if (f.lpLocked !== null) lines.push(`LP khoá: ${f.lpLocked ? 'có' : 'KHÔNG'}`);
  for (const flag of f.safetyFlags) lines.push(`⚠️ ${escapeHtml(flag)}`);
  if (f.unknowns.length > 0) {
    lines.push('');
    lines.push(`<i>Không đọc được: ${escapeHtml(f.unknowns.join(', '))}</i>`);
  }
  return lines.join('\n');
}
