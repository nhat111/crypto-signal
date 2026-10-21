import { escapeHtml } from './formatting.js';

/** Mirrors /api/airdrops (API_CONTRACT.md). Only the fields the bot reads. */
export interface AirdropCandidateDTO {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvlUsd: number;
  change7dPct: number | null;
  change30dPct: number | null;
  listedAtMs: number | null;
  reasons: string[];
}

export interface AirdropsResponseDTO {
  enabled: boolean;
  day: string | null;
  candidates: AirdropCandidateDTO[];
  fetch: { lastSuccessAt: number | null; consecutiveFailures: number; lastError: string | null } | null;
}

export interface FarmDTO {
  id: string;
  name: string;
  status: 'active' | 'claimed' | 'dropped';
  wallet: string | null;
  rewardUsd: number | null;
  netUsd: number | null;
  activity: {
    actionCount: number;
    totalCostUsd: number;
    activeWeeks: number;
    activeMonths: number;
    daysSinceLast: number | null;
  };
}

/**
 * `/farm` — list your farms.
 * `/farm DỰ_ÁN CHI_PHÍ [ghi chú]` — log one interaction and what it cost,
 * e.g. `/farm Polymarket 0,4 trade nhỏ`. The project name is everything
 * before the first number, so names with spaces work without quotes. The
 * cost is required (0 for a free action): without it, "Symbiotic deposit"
 * could be a project called that or a note, and guessing wrong files the
 * action under a new farm.
 */
export type FarmArgs =
  | { kind: 'list' }
  | { kind: 'log'; name: string; costUsd: number; note: string | null }
  | { kind: 'error'; message: string };

const USAGE = 'Dùng: /farm DỰ_ÁN CHI_PHÍ_$ [ghi chú], vd /farm Polymarket 0,4 trade nhỏ (0 nếu không tốn phí).';

export function parseFarmArgs(text: string): FarmArgs {
  const tokens = text.replace(/^\/farm(@\S+)?/i, '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { kind: 'list' };

  const costAt = tokens.findIndex((t) => /^\$?\d+([.,]\d+)?\$?$/.test(t));
  if (costAt === -1) return { kind: 'error', message: `Thiếu chi phí. ${USAGE}` };
  if (costAt === 0) return { kind: 'error', message: `Thiếu tên dự án. ${USAGE}` };

  const name = tokens.slice(0, costAt).join(' ');
  if (name.length > 80) return { kind: 'error', message: 'Tên dự án dài quá 80 ký tự.' };
  // Comma decimal is what a Vietnamese keyboard types, same as /trade and /risk.
  const costUsd = Number((tokens[costAt] as string).replace(/\$/g, '').replace(',', '.'));
  const note = tokens.slice(costAt + 1).join(' ');
  return { kind: 'log', name, costUsd, note: note === '' ? null : note.slice(0, 500) };
}

function usd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function pct(n: number | null): string {
  if (n === null) return '–';
  return `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
}

const LIST_SIZE = 10;

/**
 * Two short lists rather than one long one: the biggest tokenless
 * protocols, and the ones money is moving into this week. They answer
 * different questions (where is the most at stake / what is heating up),
 * and a single ranking would quietly pick one of them for the reader.
 */
export function formatAirdrops(data: AirdropsResponseDTO, webBaseUrl = ''): string {
  if (!data.enabled) return 'Danh sách airdrop đang tắt (AIRDROP_SCAN=off trên worker).';
  if (data.candidates.length === 0) {
    if (data.fetch && data.fetch.consecutiveFailures > 0) {
      return `Chưa đọc được DefiLlama (${data.fetch.consecutiveFailures} lần lỗi liên tiếp): ${escapeHtml(data.fetch.lastError ?? 'không rõ')}`;
    }
    return 'Chưa có danh sách airdrop. Worker quét DefiLlama 6 tiếng một lần; lần đầu chạy 5 phút sau khi khởi động.';
  }

  const line = (c: AirdropCandidateDTO, i: number) =>
    `${i + 1}. <b>${escapeHtml(c.name)}</b> · ${escapeHtml(c.category ?? '?')} · ${usd(c.tvlUsd)} · 7d ${pct(c.change7dPct)}`;
  const biggest = data.candidates.slice(0, LIST_SIZE);
  const rising = [...data.candidates]
    .filter((c) => c.change7dPct !== null && c.change7dPct > 0)
    .sort((a, b) => (b.change7dPct ?? 0) - (a.change7dPct ?? 0))
    .slice(0, LIST_SIZE);

  const parts = [
    `🪂 <b>AIRDROP: DỰ ÁN CHƯA CÓ TOKEN</b> (${data.day})`,
    '',
    '<b>TVL lớn nhất</b>',
    ...biggest.map(line),
  ];
  if (rising.length > 0) parts.push('', '<b>TVL tăng mạnh nhất 7 ngày</b>', ...rising.map(line));
  parts.push(
    '',
    `<i>${data.candidates.length} dự án. Danh sách để nghiên cứu, không phải lời khuyên: nhiều dự án không bao giờ ra token, và DefiLlama có thể chậm cập nhật token mới. Ghi lại việc farm bằng /farm.</i>`,
  );
  if (webBaseUrl) parts.push(`Đủ danh sách + chiến thuật: ${webBaseUrl}/airdrops`);
  return parts.join('\n');
}

export function formatFarms(farms: FarmDTO[]): string {
  if (farms.length === 0) {
    return `Chưa có dự án nào đang farm.\n${USAGE}`;
  }
  const active = farms.filter((f) => f.status === 'active');
  const done = farms.filter((f) => f.status !== 'active');
  const spent = farms.reduce((s, f) => s + f.activity.totalCostUsd, 0);
  const received = farms.reduce((s, f) => s + (f.rewardUsd ?? 0), 0);

  const parts = ['🌾 <b>FARM AIRDROP</b>', ''];
  for (const f of active) {
    const a = f.activity;
    const last = a.daysSinceLast === null ? 'chưa có tương tác' : a.daysSinceLast === 0 ? 'hôm nay' : `${a.daysSinceLast} ngày trước`;
    parts.push(
      `• <b>${escapeHtml(f.name)}</b>${f.wallet ? ` (${escapeHtml(f.wallet)})` : ''}: ${a.actionCount} lần, ${a.activeWeeks} tuần, ${a.activeMonths} tháng · tốn ${usd(a.totalCostUsd)} · lần cuối ${last}`,
    );
  }
  if (done.length > 0) {
    parts.push('', '<b>Đã xong</b>');
    for (const f of done) {
      const result = f.status === 'dropped' ? 'bỏ' : f.netUsd === null ? 'đã claim' : `lãi/lỗ ${f.netUsd >= 0 ? '+' : '-'}${usd(Math.abs(f.netUsd))}`;
      parts.push(`• ${escapeHtml(f.name)}: ${result} (tốn ${usd(f.activity.totalCostUsd)})`);
    }
  }
  parts.push('', `Tổng đã tốn ${usd(spent)} · đã nhận ${usd(received)}`);
  const stale = active.filter((f) => f.activity.daysSinceLast !== null && f.activity.daysSinceLast >= 14);
  if (stale.length > 0) {
    parts.push(`<i>Hơn 2 tuần chưa đụng: ${stale.map((f) => escapeHtml(f.name)).join(', ')}. Đa số đợt airdrop tính số tuần/tháng có hoạt động.</i>`);
  }
  return parts.join('\n');
}

export function formatFarmLogged(farm: FarmDTO, costUsd: number): string {
  const a = farm.activity;
  return [
    `✅ Đã ghi <b>${escapeHtml(farm.name)}</b>: ${usd(costUsd)}`,
    `Tổng: ${a.actionCount} lần · ${a.activeWeeks} tuần · ${a.activeMonths} tháng · tốn ${usd(a.totalCostUsd)}`,
  ].join('\n');
}
