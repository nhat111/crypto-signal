import { ACCOUNT_USD_MIN, RISK_PCT_MAX, RISK_PCT_MIN } from '@crypto-signal/shared';

/**
 * `/risk` — show the chat's account and risk per trade.
 * `/risk VỐN [%RỦI_RO]` — set them, e.g. `/risk 1500 1` or `/risk 1500$ 0,5%`.
 * `/risk off` — forget the account (alerts go back to the example size).
 *
 * The bounds are checked here as well as in the API so the reply can say
 * which number was wrong, in Vietnamese, instead of a generic failure.
 */
export type RiskArgs =
  | { kind: 'show' }
  | { kind: 'clear' }
  | { kind: 'set'; accountUsd: number; riskPct: number | null }
  | { kind: 'error'; message: string };

function parseAmount(raw: string, suffix: RegExp): number | null {
  // A comma decimal is what a Vietnamese keyboard types ("0,5" is 0.5),
  // same as /trade. A thousands separator is not supported: "1.000" reads
  // as 1, which the minimum account then refuses rather than accepting.
  const n = Number(raw.replace(suffix, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseRiskArgs(text: string): RiskArgs {
  const tokens = text.replace(/^\/risk(@\S+)?/i, '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { kind: 'show' };
  if (tokens.length === 1 && /^(off|xoá|xóa|clear)$/i.test(tokens[0] as string)) return { kind: 'clear' };
  if (tokens.length > 2) return { kind: 'error', message: 'Quá nhiều số. Dùng: /risk VỐN [%RỦI_RO], vd /risk 1500 1' };

  const accountUsd = parseAmount(tokens[0] as string, /\$$/);
  if (accountUsd === null || accountUsd < ACCOUNT_USD_MIN) {
    return { kind: 'error', message: `Vốn phải là số từ ${ACCOUNT_USD_MIN}$ trở lên, viết liền không dấu chấm ngăn nghìn (vd 1500, không phải 1.500).` };
  }
  if (tokens[1] === undefined) return { kind: 'set', accountUsd, riskPct: null };

  const riskPct = parseAmount(tokens[1], /%$/);
  if (riskPct === null || riskPct < RISK_PCT_MIN || riskPct > RISK_PCT_MAX) {
    return { kind: 'error', message: `Rủi ro mỗi lệnh phải từ ${RISK_PCT_MIN}% đến ${RISK_PCT_MAX}% vốn (thường dùng 0,5–1%).` };
  }
  return { kind: 'set', accountUsd, riskPct };
}
