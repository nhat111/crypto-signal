import type { MarketSnapshot } from '@crypto-signal/indicators';
import type { ConfidenceWeights, Thresholds } from '@crypto-signal/shared';
import { leveragedRally } from './rules/leveragedRally.js';
import { spotConfirmedRally } from './rules/spotConfirmedRally.js';
import { shortCoveringPossible } from './rules/shortCoveringPossible.js';
import { sellingAbsorptionPossible } from './rules/sellingAbsorptionPossible.js';
import { bullishSpotDivergence } from './rules/bullishSpotDivergence.js';
import { longLiquidation } from './rules/longLiquidation.js';
import { shortLiquidation } from './rules/shortLiquidation.js';
import { longCrowding } from './rules/longCrowding.js';
import { shortCrowding } from './rules/shortCrowding.js';
import type { RuleContext, Signal, SignalRule, SignalType } from './types.js';

/**
 * All 9 rules run independently against the same snapshot — a market can
 * legitimately be, say, both LONG_CROWDING and LEVERAGED_RALLY at once.
 * The engine never picks a "winner"; it's purely deterministic fan-out
 * (rule: "Signal engine không phụ thuộc UI", "AI không được quyết định
 * signal").
 */
const RULES: SignalRule[] = [
  leveragedRally,
  spotConfirmedRally,
  shortCoveringPossible,
  sellingAbsorptionPossible,
  bullishSpotDivergence,
  longLiquidation,
  shortLiquidation,
  longCrowding,
  shortCrowding,
];

export interface EvaluateSignalsOptions {
  thresholds: Thresholds;
  confidenceWeights: ConfidenceWeights;
  getHistoricalScore?: (signalType: SignalType) => number | undefined;
}

export function evaluateSignals(snapshot: MarketSnapshot, options: EvaluateSignalsOptions): Signal[] {
  const ctx: RuleContext = {
    snapshot,
    thresholds: options.thresholds,
    confidenceWeights: options.confidenceWeights,
    getHistoricalScore: options.getHistoricalScore ?? (() => undefined),
  };

  const signals: Signal[] = [];
  for (const rule of RULES) {
    const signal = rule(ctx);
    if (signal) signals.push(signal);
  }
  return signals;
}
