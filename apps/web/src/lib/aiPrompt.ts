import { FLOW_META } from './coinFlow';
import type { CoinFlow, SetupCohortComparison, TradeSetup, TrendState } from './types';

/** Where the reading guide is served (apps/web/public), so a chat AI with browsing can fetch it itself. */
export const AI_GUIDE_PATH = '/guide-for-ai.md';

const KIND: Record<TradeSetup['kind'], string> = { pullback: 'Hồi về hỗ trợ', breakout_retest: 'Phá vùng rồi test lại' };
const TREND: Record<TrendState['trend'], string> = { up: 'Tăng', down: 'Giảm', sideways: 'Đi ngang' };

/** Same shape as the setup reasons print prices, so the copy and the card read the same numbers. */
const fmt = (n: number): string =>
  n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(5).replace(/\.?0+$/, '');

function hoursAgo(fromMs: number, nowMs: number): string {
  const h = Math.max(0, (nowMs - fromMs) / 3_600_000);
  return h < 1 ? 'dưới 1 giờ' : h < 48 ? `${Math.round(h)} giờ` : `${Math.round(h / 24)} ngày`;
}

function pct(from: number, to: number): string {
  const v = ((to - from) / from) * 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function trendLine(t: TrendState): string {
  const ema = t.aboveEma === null ? '' : `, ${t.aboveEma ? 'trên' : 'dưới'} EMA${t.emaPeriod}`;
  const broken = t.event === 'up_broken' ? ', vừa gãy cấu trúc tăng' : t.event === 'down_broken' ? ', vừa gãy cấu trúc giảm' : '';
  return `${TREND[t.trend]}${ema}${broken}`;
}

export interface SetupPromptContext {
  /** BTC's daily read; the setup detector never looks at it, which is the point of including it. */
  btcTrend?: TrendState;
  comparison?: SetupCohortComparison;
  minResolved: number;
  nowMs: number;
  /** Absolute origin for the guide link, e.g. https://trackingticker.vercel.app. */
  origin?: string;
}

/**
 * A setup as plain text for a chat AI.
 *
 * A screenshot makes the AI read numbers off pixels and guess the rules
 * behind them. This hands it the numbers exactly, plus the three things
 * the card itself does not weigh and a reader skips most often: how old
 * the setup is (the entry is a 4H close, not the live price), what BTC's
 * daily trend is (the detector checks only the coin's own), and whether
 * the setups have any recorded edge yet. It ends by asking for the case
 * against, because a chat AI asked "should I enter?" tends to agree.
 */
export function setupAiPrompt(s: TradeSetup, ctx: SetupPromptContext): string {
  const risk = s.entry - s.stop;
  const lines: string[] = [
    `Setup 4H từ tool cá nhân (Crypto Market Health Monitor). Ứng viên, không phải lệnh.`,
    `Cách đọc tool: ${ctx.origin ?? ''}${AI_GUIDE_PATH}`,
    '',
    `Coin: ${s.symbol} · ${KIND[s.kind]}${s.cohort === 'watchlist' ? ' · ⭐ coin mạnh (watchlist)' : ''} · nến ${s.exchange === 'okx' ? 'OKX' : 'Binance'}`,
    `Phát hiện cách đây ${hoursAgo(s.detectedAt, ctx.nowMs)}, trên nến 4H đã đóng. Giá vào là giá đóng nến đó, không phải giá hiện tại.`,
    `Vào ${fmt(s.entry)} · Cắt lỗ ${fmt(s.stop)} (${pct(s.entry, s.stop)}) · Chốt lời ${fmt(s.target)} (${pct(s.entry, s.target)}) · R:R 1:${s.rr.toFixed(1)}`,
    `Khối lượng theo rủi ro: số coin = vốn × %rủi ro ÷ ${fmt(risk)}.`,
    '',
    'Lý do bộ dò đưa ra:',
    // The last reason is the plan line, already printed above as numbers.
    ...s.reasons.slice(0, -1).map((r) => `- ${r}`),
  ];

  if (s.context) {
    const rs = s.context.rs30d === null ? '' : `, RS 30 ngày so với BTC ${s.context.rs30d >= 0 ? '+' : ''}${s.context.rs30d.toFixed(0)}%`;
    lines.push(`- Quét ngày ${s.context.scanDay}: nhãn dòng tiền 7 ngày "${FLOW_META[s.context.flow as CoinFlow]?.label ?? s.context.flow}"${rs}.`);
  }

  lines.push('', 'Bộ dò KHÔNG xét:');
  lines.push(ctx.btcTrend ? `- Xu hướng 1D của BTC, hiện là: ${trendLine(ctx.btcTrend)}.` : '- Xu hướng 1D của BTC (không đọc được lúc chép).');
  lines.push('- Tin tức, lịch unlock token, giá hiện tại.');

  const c = ctx.comparison;
  if (c && s.cohort !== 'core') {
    const n = Math.min(c.watchlist.resolved, c.scan.resolved);
    lines.push(
      '',
      c.verdict === null
        ? `Kiểm chứng: chưa có kết luận setup trên coin mạnh có tốt hơn coin khác không (${n}/${ctx.minResolved} setup kết thúc mỗi bên). Chưa có bằng chứng setup có lợi thế.`
        : `Kiểm chứng: ${c.verdict === 'beats' ? 'setup trên coin mạnh tốt hơn coin khác' : c.verdict === 'worse' ? 'setup trên coin mạnh tệ hơn coin khác' : 'chưa phân biệt được coin mạnh với coin khác'} (⭐ ${c.watchlist.targets}/${c.watchlist.resolved}, khác ${c.scan.targets}/${c.scan.resolved} chạm chốt lời).`,
    );
  }

  lines.push(
    '',
    'Hãy: (1) nêu điểm ủng hộ và điểm chống, kể cả xu hướng BTC; (2) tôi cần kiểm tra gì thêm, nhất là giá hiện tại so với giá vào và cắt lỗ; (3) khối lượng nếu vốn ___$ và rủi ro ___%. Đừng chỉ xác nhận điều tôi muốn nghe.',
  );
  return lines.join('\n');
}
