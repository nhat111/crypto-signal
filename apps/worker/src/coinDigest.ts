import type { CoinScanEdgeReport, CoinScanRow } from '@crypto-signal/db';
import type { CoinFlow } from '@crypto-signal/indicators';

/** Same wording as the bot's /coins and the web page. */
const FLOW: Record<CoinFlow, string> = {
  spot_led: 'Spot mua dẫn',
  spot_and_leverage: 'Spot + đòn bẩy',
  leverage_led: 'Đòn bẩy kéo',
  short_covering: 'Short đóng lệnh',
  up_unconfirmed: 'Tăng, chưa xác nhận',
  spot_selling: 'Spot bán ròng',
  shorts_building: 'Short mở thêm',
  long_unwind: 'Long xả đòn bẩy',
  down_unconfirmed: 'Giảm, chưa rõ phe',
  accumulation: 'Đi ngang, spot gom',
  distribution: 'Đi ngang, spot xả',
  leverage_building: 'Đòn bẩy tích tụ',
  quiet: 'Yên ắng',
};

/** The labels where spot buyers, not leverage, are doing the work. */
const SPOT_BUYING: CoinFlow[] = ['spot_led', 'accumulation'];
const TOP = 3;

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const coin = (symbol: string): string => escapeHtml(symbol.replace(/USDT$/, ''));
const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;

/**
 * The morning digest's coin section: the strongest few against BTC with
 * who is moving them, and which coins turned to spot buying since the day
 * before. Short on purpose — /coins has the rest. Empty when there is no
 * scan for the day, so the digest simply goes without it.
 *
 * Only labels that changed between two days read from the same exchange
 * count as a change: OKX and Binance flow differ, and a switch of venue is
 * not news about the coin.
 */
export function formatCoinDigest(today: CoinScanRow[], previous: CoinScanRow[], edge: CoinScanEdgeReport[] = []): string[] {
  if (today.length === 0) return [];
  const exchange = today[0]?.exchange;
  const strongest = today
    .filter((r) => r.symbol !== 'BTCUSDT' && r.rs30d !== null)
    .sort((a, b) => (b.rs30d as number) - (a.rs30d as number))
    .slice(0, TOP);

  const lines = [`🪙 <b>Top ${today.length} coin</b>${exchange === 'okx' ? ' <i>(nguồn OKX)</i>' : ''}`];
  if (strongest.length > 0) {
    lines.push(`Mạnh nhất vs BTC 30N: ${strongest.map((r) => `${coin(r.symbol)} ${signed(r.rs30d as number)} (${FLOW[r.flow] ?? r.flow})`).join(' · ')}`);
  }

  const sameVenue = previous.length > 0 && previous[0]?.exchange === exchange;
  if (sameVenue) {
    const before = new Map(previous.map((r) => [r.symbol, r.flow]));
    const turned = today.filter((r) => {
      const was = before.get(r.symbol);
      return was !== undefined && SPOT_BUYING.includes(r.flow) && !SPOT_BUYING.includes(was);
    });
    if (turned.length > 0) lines.push(`Vừa chuyển sang spot mua: ${turned.map((r) => coin(r.symbol)).join(', ')}`);
  }

  const edgeLine = formatEdgeLine(edge.find((r) => r.exchange === exchange));
  if (edgeLine) lines.push(edgeLine);

  lines.push('Chi tiết: /coins');
  return lines;
}

const VERDICT: Record<string, string> = {
  beats: 'có lợi thế thật',
  worse: 'tệ hơn nhóm yếu nhất',
  indistinguishable: 'chưa phân biệt được',
};

/**
 * The evidence for the ranking above it, once there is any. Silent until
 * both ends of the RS comparison clear the sample floor: "not enough data"
 * every morning for two months would teach the reader to skip the line.
 */
export function formatEdgeLine(report: CoinScanEdgeReport | undefined): string | null {
  const rs = report?.relativeStrength;
  if (!report || !rs || rs.verdict === null || rs.group.hitPct === null || rs.baseline.hitPct === null) return null;
  return (
    `Kiểm chứng ${report.horizonDays}N: nhóm mạnh nhất thắng BTC ${rs.group.hitPct.toFixed(0)}% ` +
    `vs nhóm yếu nhất ${rs.baseline.hitPct.toFixed(0)}% (n=${rs.group.samples}) — ${VERDICT[rs.verdict] ?? rs.verdict}`
  );
}
