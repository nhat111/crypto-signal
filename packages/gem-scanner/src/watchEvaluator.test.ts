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

describe('trailing stop', () => {
  const entryOnly = { entryPrice: 100, entryLiquidityUsd: 10_000 };
  // Armed at +25%, trailing 20% behind the high. Those two together are
  // what keeps a position that was properly up from returning to a loss:
  // the earliest a trailing stop can arm is a peak of 125, and 20% below
  // 125 is 100 — the entry price.
  const thresholds = {
    stopLossPct: 25,
    takeProfitPct: 50,
    liquidityCollapsePct: 50,
    riskScoreAlert: 80,
    trailingStopPct: 20,
    trailingArmPct: 25,
  };
  const quiet = { liquidityUsd: 10_000, riskScore: 10, safetyVerdict: 'safe' as const };

  it('fires on the round trip that both fixed triggers miss', () => {
    // 100 -> 140 -> 112 is the whole reason this exists: it never reaches
    // the take-profit at 150 and never reaches the stop-loss at 75, so
    // without this the entire run is handed back in silence.
    const reasons = evaluateWatch({ ...entryOnly, peakPrice: 140 }, { ...quiet, priceUsd: 112 }, thresholds);
    expect(reasons).toEqual(['trailing_stop']);
  });

  it('never lets a position that armed the stop come back to a loss', () => {
    // The weakest possible arming: a peak of exactly +25%. Even then the
    // trigger sits at the entry price, not below it.
    const atBreakeven = evaluateWatch({ ...entryOnly, peakPrice: 125 }, { ...quiet, priceUsd: 100 }, thresholds);
    expect(atBreakeven).toContain('trailing_stop');
  });

  it('stays quiet while the position is only mildly off its high', () => {
    // 140 -> 120 is a 14% giveback, inside the 20% allowed.
    expect(evaluateWatch({ ...entryOnly, peakPrice: 140 }, { ...quiet, priceUsd: 120 }, thresholds)).toEqual([]);
  });

  it('does not arm on a peak that never cleared the arming gain', () => {
    // Up 10% at best, then halved. That is the stop-loss's event, and the
    // trailing stop must not also claim it — reporting one dump as two
    // separate stops is how a single alert starts looking like two.
    const reasons = evaluateWatch({ ...entryOnly, peakPrice: 110 }, { ...quiet, priceUsd: 50 }, thresholds);
    expect(reasons).toEqual(['stop_loss']);
  });

  it('does not arm on a plain dump from entry', () => {
    const reasons = evaluateWatch({ ...entryOnly, peakPrice: 100 }, { ...quiet, priceUsd: 70 }, thresholds);
    expect(reasons).toEqual(['stop_loss']);
  });

  it('measures the giveback from the peak, not from the entry', () => {
    // Up 47% and holding: 2% off a peak of 150. Measured against entry
    // instead this is a large gain, which would also say nothing — so the
    // discriminating case is the first test, and this one guards the sign.
    expect(evaluateWatch({ ...entryOnly, peakPrice: 150 }, { ...quiet, priceUsd: 147 }, thresholds)).toEqual([]);
  });

  it('knows a full giveback is smaller than the gain that produced it', () => {
    // +40% back to breakeven is a 28.6% fall from the peak. A trailing
    // distance of 30% — picked as if giveback and gain were the same
    // number — would sleep through exactly the case it was chosen for.
    const wrongWay = { ...thresholds, trailingStopPct: 30, trailingArmPct: 25 };
    expect(evaluateWatch({ ...entryOnly, peakPrice: 140 }, { ...quiet, priceUsd: 100 }, wrongWay)).toEqual([]);
    expect(evaluateWatch({ ...entryOnly, peakPrice: 140 }, { ...quiet, priceUsd: 100 }, thresholds)).toContain('trailing_stop');
  });

  it('is disabled, not guessed, for a watch armed before the column existed', () => {
    const { trailingStopPct: _s, trailingArmPct: _a, ...noTrailing } = thresholds;
    expect(evaluateWatch({ ...entryOnly, peakPrice: null }, { ...quiet, priceUsd: 100 }, thresholds)).toEqual([]);
    expect(evaluateWatch({ ...entryOnly, peakPrice: 140 }, { ...quiet, priceUsd: 100 }, noTrailing)).toEqual([]);
    expect(evaluateWatch(entryOnly, { ...quiet, priceUsd: 100 }, thresholds)).toEqual([]);
  });

  it('treats a trailing distance of zero as off, not as a hair trigger', () => {
    // At 0 the arithmetic arms on any peak and fires on any tick down, so
    // GEM_WATCH_TRAILING_STOP_PCT=0 would alert on every watch on its first
    // pass — a position that has not moved reported as having given back
    // its gain.
    const zero = { ...thresholds, trailingStopPct: 0, trailingArmPct: 0 };
    expect(evaluateWatch({ ...entryOnly, peakPrice: 100 }, { ...quiet, priceUsd: 100 }, zero)).toEqual([]);
  });

  it('ignores a peak of zero rather than dividing by it', () => {
    expect(evaluateWatch({ ...entryOnly, peakPrice: 0 }, { ...quiet, priceUsd: 100 }, thresholds)).toEqual([]);
  });
});
