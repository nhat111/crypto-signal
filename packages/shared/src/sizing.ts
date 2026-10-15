/**
 * Position size from the reader's own account: how much to buy so that
 * being stopped out costs a fixed share of the account.
 *
 * This is the one lever that works whether or not the signals do. The
 * setups and the coin scan have no verdict yet (their edge reports are
 * still collecting samples), so the honest way to act on them is small
 * enough that being wrong is affordable — and "small enough" is a number
 * that depends on the account, which the alert used to replace with a
 * round example of 1,000$.
 *
 * Shared and pure because two callers print it — the worker's setup alert
 * and the bot's /setups — and they must never disagree on the size.
 */

export interface RiskProfile {
  accountUsd: number;
  /** Percent of the account lost if the stop is hit, e.g. 1 for 1%. */
  riskPct: number;
}

export const DEFAULT_RISK_PCT = 1;
/**
 * Bounds on what /risk accepts. Below 10$ the sizes round to nothing; above
 * 5% a run of five stops — routine for any setup with a sub-50% hit rate —
 * costs a quarter of the account. The upper bound is a refusal, not a
 * suggestion: the database check enforces it too.
 */
export const ACCOUNT_USD_MIN = 10;
export const RISK_PCT_MIN = 0.1;
export const RISK_PCT_MAX = 5;

export type SizingSide = 'long' | 'short';

export type PositionSize =
  | {
      ok: true;
      /** Units of the asset that lose exactly `riskUsd` at the stop. */
      units: number;
      notionalUsd: number;
      riskUsd: number;
      /** Distance from entry to stop as a percent of entry. */
      stopDistancePct: number;
      /**
       * Notional over the account. Above 1 the size cannot be bought on
       * spot with the account alone; it needs futures leverage, or a
       * smaller position that then risks less than the target.
       */
      leverage: number;
      /** The most the account can buy on spot (min of `units` and account / entry), and what it risks. */
      spotUnits: number;
      spotRiskUsd: number;
    }
  | { ok: false; reason: 'invalid_input' | 'stop_wrong_side' };

export function positionSize(profile: RiskProfile, side: SizingSide, entry: number, stop: number): PositionSize {
  const { accountUsd, riskPct } = profile;
  if (![accountUsd, riskPct, entry, stop].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, reason: 'invalid_input' };
  }
  const perUnitRisk = side === 'long' ? entry - stop : stop - entry;
  // A stop on the wrong side of entry is not a tiny risk, it is no stop at
  // all — dividing by it would print an enormous size.
  if (perUnitRisk <= 0) return { ok: false, reason: 'stop_wrong_side' };

  const riskUsd = (accountUsd * riskPct) / 100;
  const units = riskUsd / perUnitRisk;
  const notionalUsd = units * entry;
  const spotUnits = Math.min(units, accountUsd / entry);
  return {
    ok: true,
    units,
    notionalUsd,
    riskUsd,
    stopDistancePct: (perUnitRisk / entry) * 100,
    leverage: notionalUsd / accountUsd,
    spotUnits,
    spotRiskUsd: spotUnits * perUnitRisk,
  };
}

const formatUnits = (n: number): string => (n < 1 ? n.toPrecision(3) : n.toFixed(2));

const formatUsd = (n: number): string =>
  n >= 100 ? `${Math.round(n).toLocaleString('en-US')}$` : `${n.toFixed(2).replace(/\.?0+$/, '')}$`;

/**
 * The size as plain-text lines (no HTML), shared by the alert and /setups.
 * `asset` is the base asset, e.g. "SOL". `example` labels a size computed
 * on a stand-in account rather than the reader's own.
 */
export function formatPositionSize(size: PositionSize, profile: RiskProfile, asset: string, opts: { example?: boolean } = {}): string[] {
  // `=== false` narrows without strictNullChecks too (Vercel builds the API that way).
  if (size.ok === false) {
    return [size.reason === 'stop_wrong_side' ? 'Cỡ lệnh: không tính được (cắt lỗ nằm sai phía giá vào).' : 'Cỡ lệnh: không tính được.'];
  }
  const head = `Cỡ lệnh${opts.example ? ' ví dụ' : ''} (TK ${formatUsd(profile.accountUsd)}, rủi ro ${profile.riskPct}%): ${formatUnits(size.units)} ${asset} ≈ ${formatUsd(size.notionalUsd)} · mất ${formatUsd(size.riskUsd)} nếu dính cắt lỗ`;
  if (size.leverage <= 1) return [head];
  // Saying only "x3.2" would read as advice to borrow. The spot figure
  // comes first because it is the one that needs no leverage at all.
  return [
    head,
    `Vượt vốn (cần x${size.leverage.toFixed(1)}): spot tối đa ${formatUnits(size.spotUnits)} ${asset}, khi đó chỉ mất ${formatUsd(size.spotRiskUsd)} nếu dính cắt lỗ. Cắt lỗ quá gần — đừng tăng đòn bẩy cho đủ cỡ.`,
  ];
}
