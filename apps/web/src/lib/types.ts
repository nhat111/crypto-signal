/**
 * Types mirroring API_CONTRACT.md exactly. Do not add fields the API
 * doesn't document — this file is the single source of truth for the
 * shapes this app is allowed to assume exist.
 */

export type Timeframe = '5m' | '15m' | '1h' | '4h';

export const TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '1h', '4h'];

export type Horizon = '15m' | '1h' | '4h' | '24h';

export const HORIZONS: readonly Horizon[] = ['15m', '1h', '4h', '24h'];

export type HealthStatus = 'VERY_HEALTHY' | 'HEALTHY' | 'NEUTRAL' | 'WEAK' | 'VERY_WEAK';

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

export const SEVERITIES: readonly Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'];

/** Spec §7/§15 — exactly 9 signal types. */
export const SIGNAL_TYPES = [
  'LEVERAGED_RALLY',
  'SPOT_CONFIRMED_RALLY',
  'SHORT_COVERING_POSSIBLE',
  'SELLING_ABSORPTION_POSSIBLE',
  'BULLISH_SPOT_DIVERGENCE',
  'LONG_LIQUIDATION',
  'SHORT_LIQUIDATION',
  'LONG_CROWDING',
  'SHORT_CROWDING',
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export interface OverviewRow {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number;
  priceClose: number;
  priceChangePct: number;
  healthScore: number;
  healthStatus: HealthStatus;
  riskScore: number;
  dataQualityScore: number;
}

export interface OverviewResponse {
  symbols: string[];
  timeframes: Timeframe[];
  rows: OverviewRow[];
}

export interface Signal {
  signalId: string;
  symbol: string;
  timeframe: Timeframe;
  signalType: SignalType;
  severity: Severity;
  confidence: number;
  timestamp: number;
  reasons: string[];
  metrics: Record<string, number>;
}

export interface SignalsResponse {
  signals: Signal[];
}

export interface SymbolLatest extends OverviewRow {
  spotCvd: number;
  futuresCvd: number;
  openInterest: number;
  fundingRatePct: number;
  liquidationLongUsd: number;
  liquidationShortUsd: number;
}

export interface SymbolSeriesPoint {
  timestamp: number;
  priceClose: number;
  spotCvdCumulative: number;
  futuresCvdCumulative: number;
  openInterest: number;
  fundingRatePct: number;
  liquidationLongUsd: number;
  liquidationShortUsd: number;
  healthScore: number;
  riskScore: number;
}

export interface SymbolDetailResponse {
  symbol: string;
  timeframe: Timeframe;
  latest: SymbolLatest | null;
  series: SymbolSeriesPoint[];
  signals: Signal[];
}

export interface PerformanceResult {
  signalType: SignalType;
  sampleCount: number;
  horizon: Horizon;
  positiveMovePct: number;
  negativeMovePct: number;
  medianMovePct: number;
  sufficientData: boolean;
}

export interface PerformanceResponse {
  horizon: Horizon;
  results: PerformanceResult[];
}
