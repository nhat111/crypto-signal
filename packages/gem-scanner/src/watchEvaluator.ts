import type { SafetyVerdict } from './types.js';

/**
 * Sell-condition check for a user-initiated position watch
 * ("/watch SYMBOL" on the bot). Deliberately separate from evaluateGem in
 * scoring.ts: that function asks "is this a good discovery," this one asks
 * "should the person already holding this be worried" — different
 * question, different inputs (an entry snapshot instead of a fresh
 * candidate), so it stays its own pure function rather than a mode flag
 * bolted onto the scoring one.
 */

/**
 * 'pool_gone' is never produced by evaluateWatch itself — it applies when
 * there's no pair to evaluate at all, which the caller (apps/worker's
 * gemWatch.ts) detects before calling this function. It's part of the
 * union anyway so callers have exactly one reason type to store and
 * describe, not two.
 */
/** Only the sell-condition fields — deliberately not GemWatchConfig, which also carries the scheduler's check-interval, a scheduling concern this pure function has no business depending on. */
export interface WatchThresholds {
  stopLossPct: number;
  takeProfitPct: number;
  liquidityCollapsePct: number;
  riskScoreAlert: number;
}

export type WatchTriggerReason = 'stop_loss' | 'take_profit' | 'liquidity_collapse' | 'risk_spike' | 'safety_danger' | 'pool_gone';

export interface WatchEntrySnapshot {
  entryPrice: number;
  entryLiquidityUsd: number | null;
}

export interface WatchCurrentState {
  priceUsd: number;
  liquidityUsd: number | null;
  /**
   * From the token's latest regular gem_scans row, if one exists — this
   * function never re-runs safety/scoring itself. Null when the token
   * hasn't been rescanned since the watch was created (e.g. it fell out of
   * the discovery gate), in which case the risk/safety checks are simply
   * skipped rather than guessed.
   */
  riskScore: number | null;
  safetyVerdict: SafetyVerdict | null;
}

/**
 * Returns every condition that fired, not just the first — a token can be
 * both down past the stop-loss and newly flagged dangerous at the same
 * time, and the alert should say both.
 */
export function evaluateWatch(
  entry: WatchEntrySnapshot,
  current: WatchCurrentState,
  thresholds: WatchThresholds,
): WatchTriggerReason[] {
  const reasons: WatchTriggerReason[] = [];

  const pnlPct = ((current.priceUsd - entry.entryPrice) / entry.entryPrice) * 100;
  if (pnlPct <= -thresholds.stopLossPct) reasons.push('stop_loss');
  if (pnlPct >= thresholds.takeProfitPct) reasons.push('take_profit');

  if (entry.entryLiquidityUsd !== null && entry.entryLiquidityUsd > 0 && current.liquidityUsd !== null) {
    const liquidityPct = (current.liquidityUsd / entry.entryLiquidityUsd) * 100;
    if (liquidityPct <= thresholds.liquidityCollapsePct) reasons.push('liquidity_collapse');
  }

  if (current.riskScore !== null && current.riskScore >= thresholds.riskScoreAlert) reasons.push('risk_spike');
  if (current.safetyVerdict === 'danger') reasons.push('safety_danger');

  return reasons;
}

export function describeWatchReason(reason: WatchTriggerReason): string {
  switch (reason) {
    case 'stop_loss':
      return 'Price has fallen past your stop-loss threshold.';
    case 'take_profit':
      return 'Price has risen past your take-profit target.';
    case 'liquidity_collapse':
      return "Liquidity has collapsed relative to when you started watching — it's getting harder to exit.";
    case 'risk_spike':
      return 'Risk score has climbed into the danger band on its latest scan.';
    case 'safety_danger':
      return 'The safety screen now flags this token as dangerous.';
    case 'pool_gone':
      return "The pool is no longer found on DexScreener — it may have been pulled.";
  }
}
