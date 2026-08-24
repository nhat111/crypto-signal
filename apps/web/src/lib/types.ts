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
  /** Null for futures-only symbols (no Binance Spot listing) — Health Score needs a spot leg to compare against. */
  healthScore: number | null;
  healthStatus: HealthStatus | null;
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
  /** Null for futures-only symbols. */
  spotCvd: number | null;
  futuresCvd: number;
  openInterest: number;
  fundingRatePct: number;
  liquidationLongUsd: number;
  liquidationShortUsd: number;
}

export interface SymbolSeriesPoint {
  timestamp: number;
  priceClose: number;
  spotCvdCumulative: number | null;
  futuresCvdCumulative: number | null;
  openInterest: number | null;
  fundingRatePct: number | null;
  liquidationLongUsd: number | null;
  liquidationShortUsd: number | null;
  healthScore: number | null;
  riskScore: number;
}

/**
 * 20-period Bollinger Band (2 stddev) off the last 20 closed futures
 * candles. A reference range, not a buy/sell instruction — see
 * API_CONTRACT.md. Null until 20 closed candles exist for the timeframe.
 */
export interface PriceLevels {
  upper: number;
  middle: number;
  lower: number;
}

export interface SymbolDetailResponse {
  symbol: string;
  timeframe: Timeframe;
  latest: SymbolLatest | null;
  series: SymbolSeriesPoint[];
  signals: Signal[];
  priceLevels: PriceLevels | null;
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

/* ---------- Small-cap discovery (gem scanner) ---------- */

export type SafetyVerdict = 'safe' | 'caution' | 'danger' | 'unknown';

export interface Gem {
  scanId: string;
  chainId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  dexId: string;
  url: string | null;
  scannedAt: number;
  gemScore: number;
  gemComponents: Record<string, number>;
  riskScore: number;
  riskComponents: Record<string, number>;
  reasons: string[];
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fdvUsd: number | null;
  priceChange24hPct: number | null;
  buys24h: number | null;
  sells24h: number | null;
  ageDays: number | null;
  /** Null means no screen ran for this chain; 'unknown' means one ran but confirmed nothing. */
  safetyVerdict: SafetyVerdict | null;
  safetyFlags: string[] | null;
  topHolderPct: number | null;
  lpLocked: boolean | null;
}

export interface GemsResponse {
  gems: Gem[];
}

export type GemHorizon = '24h' | '7d';

export interface GemPerformance {
  horizon: GemHorizon;
  sampleCount: number;
  positiveMovePct: number | null;
  negativeMovePct: number | null;
  medianMovePct: number | null;
  liquidityCollapsePct: number | null;
  sufficientData: boolean;
}
