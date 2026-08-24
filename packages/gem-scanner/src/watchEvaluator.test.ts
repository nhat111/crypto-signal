import { describe, expect, it } from 'vitest';
import { evaluateWatch, type WatchCurrentState, type WatchEntrySnapshot, type WatchThresholds } from './watchEvaluator.js';

const thresholds: WatchThresholds = {
  stopLossPct: 25,
  takeProfitPct: 50,
  liquidityCollapsePct: 50,
  riskScoreAlert: 80,
};

const entry: WatchEntrySnapshot = { entryPrice: 1, entryLiquidityUsd: 100_000 };

function current(overrides: Partial<WatchCurrentState> = {}): WatchCurrentState {
  return { priceUsd: 1, liquidityUsd: 100_000, riskScore: 40, safetyVerdict: 'safe', ...overrides };
}

describe('evaluateWatch', () => {
  it('fires nothing when price, liquidity and risk are all unchanged', () => {
    expect(evaluateWatch(entry, current(), thresholds)).toEqual([]);
  });

  it('fires stop_loss once price has fallen past the threshold', () => {
    expect(evaluateWatch(entry, current({ priceUsd: 0.74 }), thresholds)).toContain('stop_loss');
    expect(evaluateWatch(entry, current({ priceUsd: 0.8 }), thresholds)).not.toContain('stop_loss');
  });

  it('fires take_profit once price has risen past the target', () => {
    expect(evaluateWatch(entry, current({ priceUsd: 1.51 }), thresholds)).toContain('take_profit');
    expect(evaluateWatch(entry, current({ priceUsd: 1.4 }), thresholds)).not.toContain('take_profit');
  });

  it('fires liquidity_collapse only when liquidity fell relative to entry, not in absolute terms', () => {
    expect(evaluateWatch(entry, current({ liquidityUsd: 40_000 }), thresholds)).toContain('liquidity_collapse');
    // A watch entered on thin liquidity that stays exactly as thin should not re-trigger.
    const thinEntry: WatchEntrySnapshot = { entryPrice: 1, entryLiquidityUsd: 40_000 };
    expect(evaluateWatch(thinEntry, current({ liquidityUsd: 40_000 }), thresholds)).not.toContain('liquidity_collapse');
  });

  it('skips the liquidity check when entry liquidity was never recorded', () => {
    const noEntryLiquidity: WatchEntrySnapshot = { entryPrice: 1, entryLiquidityUsd: null };
    expect(evaluateWatch(noEntryLiquidity, current({ liquidityUsd: 1 }), thresholds)).not.toContain('liquidity_collapse');
  });

  it('fires risk_spike from the latest scan data, not from anything computed here', () => {
    expect(evaluateWatch(entry, current({ riskScore: 85 }), thresholds)).toContain('risk_spike');
    expect(evaluateWatch(entry, current({ riskScore: 79 }), thresholds)).not.toContain('risk_spike');
  });

  it('skips the risk check when no recent scan data exists, rather than assuming safe', () => {
    expect(evaluateWatch(entry, current({ riskScore: null }), thresholds)).not.toContain('risk_spike');
  });

  it('fires safety_danger the moment the latest screen turns dangerous', () => {
    expect(evaluateWatch(entry, current({ safetyVerdict: 'danger' }), thresholds)).toContain('safety_danger');
  });

  it('can report multiple reasons at once', () => {
    const reasons = evaluateWatch(entry, current({ priceUsd: 0.5, safetyVerdict: 'danger' }), thresholds);
    expect(reasons).toContain('stop_loss');
    expect(reasons).toContain('safety_danger');
    expect(reasons).toHaveLength(2);
  });
});
