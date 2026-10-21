import { escapeHtml } from './formatting.js';

/** Mirrors /api/sectors and /api/flywheel (API_CONTRACT.md); only the fields read here. */
export type SectorLabelDTO = 'leading' | 'emerging' | 'fading' | 'lagging';

export interface SectorDTO {
  name: string;
  median7dPct: number;
  median30dPct: number;
  rs7d: number;
  breadth7dPct: number;
  btc7dPct: number;
  btc30dPct: number;
  label: SectorLabelDTO;
  previousLabel: SectorLabelDTO | null;
  leaders: { symbol: string; change7dPct: number }[];
}

interface FetchDTO {
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface SectorsResponseDTO {
  enabled: boolean;
  day: string | null;
  sectors: SectorDTO[];
  fetch: FetchDTO | null;
}

export interface FlywheelDTO {
  name: string;
  symbol: string | null;
  holdersRevenue30dUsd: number;
  holdersRevenueChangePct: number | null;
  yieldPct: number | null;
  priceChange30dPct: number | null;
}

export interface FlywheelResponseDTO {
  enabled: boolean;
  day: string | null;
  rows: FlywheelDTO[];
  fetch: FetchDTO | null;
}

export const SECTOR_LABEL_TEXT: Record<SectorLabelDTO, string> = {
  leading: '🟢 Dẫn dắt',
  emerging: '🔵 Đang nổi',
  fading: '🟠 Hạ nhiệt',
  lagging: '⚪ Yếu',
};

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
}

function emptyText(what: string, enabled: boolean, fetch: FetchDTO | null, offFlag: string): string {
  if (!enabled) return `${what} đang tắt (${offFlag}=off trên worker).`;
  if (fetch && fetch.consecutiveFailures > 0) {
    return `Chưa đọc được dữ liệu (${fetch.consecutiveFailures} lần lỗi liên tiếp): ${escapeHtml(fetch.lastError ?? 'không rõ')}`;
  }
  return `Chưa có dữ liệu ${what.toLowerCase()}. Worker tính mỗi ngày một lần; lần đầu chạy vài phút sau khi khởi động.`;
}

/** Grouped by label, strongest first inside each group, so the rotation reads top to bottom. */
export function formatSectors(data: SectorsResponseDTO): string {
  if (data.sectors.length === 0) return emptyText('Dòng tiền theo mảng', data.enabled, data.fetch, 'SECTOR_SCAN');
  const first = data.sectors[0] as SectorDTO;
  const parts = [
    `🧭 <b>DÒNG TIỀN THEO MẢNG</b> (${data.day})`,
    `BTC: ${pct(first.btc7dPct)} 7 ngày · ${pct(first.btc30dPct)} 30 ngày`,
  ];
  for (const label of ['leading', 'emerging', 'fading', 'lagging'] as const) {
    const group = data.sectors.filter((s) => s.label === label).sort((a, b) => b.rs7d - a.rs7d);
    if (group.length === 0) continue;
    parts.push('', `<b>${SECTOR_LABEL_TEXT[label]}</b>`);
    for (const s of group) {
      const changed = s.previousLabel && s.previousLabel !== s.label ? ` <i>(hôm trước: ${SECTOR_LABEL_TEXT[s.previousLabel].slice(3)})</i>` : '';
      const leaders = s.leaders.map((l) => `${escapeHtml(l.symbol)} ${pct(l.change7dPct)}`).join(', ');
      parts.push(`• <b>${escapeHtml(s.name)}</b> ${pct(s.median7dPct)} · ${s.breadth7dPct.toFixed(0)}% thắng BTC${changed}`);
      if (label === 'leading' || label === 'emerging') parts.push(`  ${leaders}`);
    }
  }
  parts.push(
    '',
    '<i>Số là của coin trung vị trong mảng (30 coin vốn hoá lớn nhất, CoinGecko). "Thắng BTC" là % số coin tăng hơn BTC. Mô tả dòng tiền, không phải lời khuyên mua bán.</i>',
  );
  return parts.join('\n');
}

export function formatFlywheel(data: FlywheelResponseDTO, limit = 15): string {
  if (data.rows.length === 0) return emptyText('Flywheel', data.enabled, data.fetch, 'FLYWHEEL_SCAN');
  const parts = [`🔁 <b>FLYWHEEL: DOANH THU QUAY VỀ HOLDER</b> (${data.day})`, ''];
  for (const r of data.rows.slice(0, limit)) {
    const bits = [`${usd(r.holdersRevenue30dUsd)}/30 ngày`];
    if (r.holdersRevenueChangePct !== null) bits.push(`${pct(r.holdersRevenueChangePct)} so tháng trước`);
    if (r.yieldPct !== null) bits.push(`${r.yieldPct.toFixed(1)}%/năm vốn hoá`);
    if (r.priceChange30dPct !== null) bits.push(`giá ${pct(r.priceChange30dPct)}`);
    parts.push(`• <b>${escapeHtml(r.name)}</b>${r.symbol ? ` (${escapeHtml(r.symbol)})` : ''}: ${bits.join(' · ')}`);
  }
  parts.push(
    '',
    '<i>Holders revenue theo DefiLlama: buyback, burn hoặc chia phí cho người giữ token. "%/năm vốn hoá" = 30 ngày × 12 chia vốn hoá hiện tại; trên 50% thường là khoản trả một lần. Không phải lời khuyên mua bán.</i>',
  );
  return parts.join('\n');
}
