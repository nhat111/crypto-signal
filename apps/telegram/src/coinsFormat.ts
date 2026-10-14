import type { CoinFlowDTO, CoinScanDTO, CoinsResponseDTO } from './apiClient.js';
import { escapeHtml } from './formatting.js';

/** Short Vietnamese labels for the seven-day flow read. Same wording as the web page. */
export const FLOW_LABEL: Record<CoinFlowDTO, string> = {
  spot_led: '🟢 Spot mua dẫn',
  spot_and_leverage: '🟡 Spot + đòn bẩy',
  leverage_led: '🟠 Đòn bẩy kéo',
  short_squeeze: '🟠 Short bị ép',
  short_covering: '🟠 Short đóng lệnh',
  up_unconfirmed: '⚪ Tăng, spot chưa xác nhận',
  spot_selling: '🔴 Spot bán ròng',
  shorts_building: '🔴 Short mở thêm',
  long_unwind: '🟠 Long xả đòn bẩy',
  down_unconfirmed: '⚪ Giảm, chưa rõ phe',
  accumulation: '🟢 Đi ngang, spot gom',
  distribution: '🔴 Đi ngang, spot xả',
  leverage_building: '🟡 Đi ngang, đòn bẩy tích tụ',
  quiet: '⚪ Yên ắng',
};

const TOP = 8;
const BOTTOM = 3;

const signed = (n: number | null): string => (n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
const coin = (symbol: string): string => escapeHtml(symbol.replace(/USDT$/, ''));
const dayVi = (day: string): string => day.split('-').reverse().slice(0, 2).join('/');

/** RS 30d where there is one, 7d for coins with under a month of history. BTC is the yardstick, not a candidate. */
const strength = (c: CoinScanDTO): number | null => c.rs30d ?? c.rs7d;

function line(c: CoinScanDTO): string {
  const rs = c.rs30d !== null ? `${signed(c.rs30d)} vs BTC 30N` : `${signed(c.rs7d)} vs BTC 7N`;
  return `<b>${coin(c.symbol)}</b> ${rs} · 7N ${signed(c.ret7d)} · ${FLOW_LABEL[c.flow] ?? c.flow}`;
}

/** Turns "sol", "SOL", "solusdt" into SOLUSDT. */
export function coinArg(text: string | undefined): string | null {
  const arg = text?.split(/\s+/)[1]?.trim().toUpperCase();
  if (!arg) return null;
  return arg.endsWith('USDT') ? arg : `${arg}USDT`;
}

/** /coins — strongest and weakest against BTC, each with who moved it this week. */
export function formatCoins(data: CoinsResponseDTO): string {
  if (!data.enabled) return 'Quét top coin đang tắt (COIN_SCAN=off trên worker).';
  if (data.rows.length === 0 || !data.day) {
    const failing = data.fetch && data.fetch.consecutiveFailures > 0 ? `\nLần quét gần nhất lỗi: ${escapeHtml(data.fetch.lastError ?? 'không rõ')}` : '';
    return `Chưa có lần quét top coin nào — worker quét một lần mỗi ngày sau khi nến 1D đóng.${failing}`;
  }

  const ranked = data.rows.filter((c) => c.symbol !== 'BTCUSDT' && strength(c) !== null).sort((a, b) => (strength(b) as number) - (strength(a) as number));
  const btc = data.rows.find((c) => c.symbol === 'BTCUSDT');
  const lines = [`<b>Top ${data.rows.length} coin theo volume</b> — nến 1D đến ${dayVi(data.day)}`];
  if (data.exchange === 'okx') lines.push('<i>Nguồn: OKX — Binance đang chặn IP máy chủ, nên hạng volume và dòng tiền là của OKX.</i>');
  lines.push('');
  if (btc) lines.push(`BTC: 7N ${signed(btc.ret7d)} · 30N ${signed(btc.ret30d)} · ${FLOW_LABEL[btc.flow] ?? btc.flow}`, '');

  lines.push('💪 <b>Mạnh nhất so với BTC</b>');
  for (const c of ranked.slice(0, TOP)) lines.push(line(c));
  const rest = ranked.slice(TOP);
  if (rest.length > 0) {
    lines.push('', '🥀 <b>Yếu nhất</b>');
    for (const c of rest.slice(-BOTTOM).reverse()) lines.push(line(c));
  }

  const spotLed = data.rows.filter((c) => c.flow === 'spot_led' || c.flow === 'accumulation').map((c) => coin(c.symbol));
  if (spotLed.length > 0) lines.push('', `Spot mua ròng 7 ngày: ${spotLed.join(', ')}`);

  lines.push('', 'Chi tiết một coin: /coins SOL', '<i>Mô tả 7–30 ngày đã qua, không phải dự báo. Mạnh hơn BTC chưa phải là lý do để mua.</i>');
  return lines.join('\n');
}

/** /coins SOL — every number behind the line, and what could not be read. */
export function formatCoinDetail(data: CoinsResponseDTO, symbol: string): string {
  const c = data.rows.find((r) => r.symbol === symbol);
  if (!c) {
    return data.rows.length === 0
      ? 'Chưa có lần quét top coin nào.'
      : `${coin(symbol)} không nằm trong top ${data.rows.length} coin theo volume lần quét này.`;
  }
  const lines = [
    `<b>${coin(c.symbol)}</b> — ${FLOW_LABEL[c.flow] ?? c.flow}`,
    `Hạng volume #${c.volumeRank}${data.exchange === 'okx' ? ' trên OKX' : ''} · nến 1D đến ${dayVi(c.day)}`,
    '',
    `Giá: 7N ${signed(c.ret7d)} · 30N ${signed(c.ret30d)}`,
  ];
  if (c.symbol !== 'BTCUSDT') lines.push(`So với BTC: 7N ${signed(c.rs7d)} · 30N ${signed(c.rs30d)}`);
  lines.push('');
  for (const r of c.reasons) lines.push(`• ${escapeHtml(r)}`);
  const f = c.fundamentals;
  if (f && (f.chain || f.protocol)) {
    const matched = [f.chain && `chain ${f.chain.name}`, f.protocol && `protocol ${f.protocol.name}`].filter(Boolean).join(' · ');
    lines.push('', `<b>Cơ bản</b> (DefiLlama: ${escapeHtml(matched)})`);
    for (const b of f.bull) lines.push(`▲ ${escapeHtml(b)}`);
    for (const b of f.bear) lines.push(`▼ ${escapeHtml(b)}`);
    if (f.bull.length === 0 && f.bear.length === 0) lines.push('Phí, TVL, stablecoin không đổi đủ lớn để tính.');
  }
  const unknowns = [...c.unknowns, ...(f?.unknowns ?? [])];
  if (unknowns.length > 0) {
    lines.push('', 'Không đọc được:');
    for (const u of unknowns) lines.push(`• ${escapeHtml(u)}`);
  }
  lines.push('', '<i>Mô tả, không phải dự báo.</i>');
  return lines.join('\n');
}
