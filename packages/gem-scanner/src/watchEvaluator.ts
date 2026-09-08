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
  /**
   * How far below the highest price seen since entry counts as giving the
   * run back. Optional because a watch armed before migration 023 has no
   * value for it, and inventing one would apply a trigger the person never
   * agreed to; those watches simply keep the two fixed triggers they had.
   */
  trailingStopPct?: number;
  /**
   * How far up the position must have been, at any point, before the
   * trailing stop starts applying.
   *
   * Without this the trailing stop is just a second stop-loss: from the
   * moment of entry the peak IS the entry, so it would fire on a plain
   * dump alongside the real stop and report one event twice. Arming it in
   * profit also makes the distance meaningful — once armed at +25% with a
   * 20% trailing distance, the trigger sits at or above the entry price,
   * so a position that was properly up cannot come all the way back to a
   * loss unnoticed.
   */
  trailingArmPct?: number;
}

export type WatchTriggerReason =
  | 'stop_loss'
  | 'trailing_stop'
  | 'take_profit'
  | 'liquidity_collapse'
  | 'risk_spike'
  | 'safety_danger'
  | 'pool_gone';

export interface WatchEntrySnapshot {
  entryPrice: number;
  entryLiquidityUsd: number | null;
  /**
   * Highest price observed since the watch was armed, entry price included
   * — so before the position has ever been up, this equals entryPrice and
   * the trailing stop sits a fixed distance below entry, same as any other
   * stop. Null only for a pre-023 watch, which disables the trigger rather
   * than guessing a peak from a single current price.
   */
  peakPrice?: number | null;
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

  // Measured from the peak, which is what makes this different from the
  // stop-loss above rather than a second copy of it: a position that ran up
  // and slid back is down against its own high while still level with entry.
  //
  // Note the giveback is not the gain: running to +40% and returning to
  // breakeven is a 28.6% fall from the peak, not 40%. A trailing distance
  // picked as if those were the same number silently misses the case it
  // was chosen for.
  const peak = entry.peakPrice;
  const trailingPct = thresholds.trailingStopPct;
  const armPct = thresholds.trailingArmPct;
  // trailingPct > 0 is not defensive noise: at 0 the trigger reads "sell the
  // instant it ticks down from its high", which fires on a position that
  // has not moved at all. GEM_WATCH_TRAILING_STOP_PCT=0 would otherwise
  // alert on every watch on its first pass.
  if (peak !== null && peak !== undefined && peak > 0 && trailingPct !== undefined && trailingPct > 0 && armPct !== undefined) {
    const peakGainPct = ((peak - entry.entryPrice) / entry.entryPrice) * 100;
    if (peakGainPct >= armPct) {
      const fromPeakPct = ((current.priceUsd - peak) / peak) * 100;
      if (fromPeakPct <= -trailingPct) reasons.push('trailing_stop');
    }
  }

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
    case 'trailing_stop':
      return 'This was up enough to arm a trailing stop, and has now fallen that far back from its high.';
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
