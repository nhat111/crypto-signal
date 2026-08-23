import type { ConfidenceWeights, SymbolId, Thresholds, Timeframe } from '@crypto-signal/shared';
import type { MarketSnapshot } from '@crypto-signal/indicators';

export type SignalType =
  | 'LEVERAGED_RALLY'
  | 'SPOT_CONFIRMED_RALLY'
  | 'SHORT_COVERING_POSSIBLE'
  | 'SELLING_ABSORPTION_POSSIBLE'
  | 'BULLISH_SPOT_DIVERGENCE'
  | 'LONG_LIQUIDATION'
  | 'SHORT_LIQUIDATION'
  | 'LONG_CROWDING'
  | 'SHORT_CROWDING';

export const ALL_SIGNAL_TYPES: readonly SignalType[] = [
  'LEVERAGED_RALLY',
  'SPOT_CONFIRMED_RALLY',
  'SHORT_COVERING_POSSIBLE',
  'SELLING_ABSORPTION_POSSIBLE',
  'BULLISH_SPOT_DIVERGENCE',
  'LONG_LIQUIDATION',
  'SHORT_LIQUIDATION',
  'LONG_CROWDING',
  'SHORT_CROWDING',
];

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export const SEVERITY_ORDER: readonly Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'];

/**
 * Exact shape required by the spec (§15): symbol, timeframe, signalType,
 * severity, confidence, timestamp, reasons, metrics. `reasons` is always
 * plain, explainable, probability/risk-framed language — never a directive
 * like "market will dump" (spec §16/§38).
 */
export interface Signal {
  symbol: SymbolId;
  timeframe: Timeframe;
  signalType: SignalType;
  severity: Severity;
  /** 0-100. */
  confidence: number;
  timestamp: number;
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
}

export interface RuleContext {
  snapshot: MarketSnapshot;
  thresholds: Thresholds;
  confidenceWeights: ConfidenceWeights;
  /** 0-100 per-signal-type historical win-rate score from signal_outcomes (Phase 9). undefined until enough samples exist — see ASSUMPTIONS.md §8. */
  getHistoricalScore: (signalType: SignalType) => number | undefined;
}

export type SignalRule = (ctx: RuleContext) => Signal | null;
