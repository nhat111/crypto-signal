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
  /**
   * Sent alongside the list rather than embedded per signal: there are
   * nine types and up to five hundred rows, so a copy per row would be the
   * same handful of objects repeated a hundred times over the wire.
   */
  verdicts?: SignalVerdict[];
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
  verdicts?: SignalVerdict[];
}

export interface PerformanceResult {
  signalType: SignalType;
  sampleCount: number;
  horizon: Horizon;
  positiveMovePct: number;
  negativeMovePct: number;
  medianMovePct: number;
  /**
   * The same hit rates counted against `costPct` instead of against zero:
   * a window that rose 0.02% is a "positive move" and a losing trade. The
   * server sends the cost floor it used rather than the client assuming
   * one, so the two can never drift apart.
   */
  netPositiveMovePct: number;
  netNegativeMovePct: number;
  costPct: number;
  sufficientData: boolean;
  /**
   * The comparison against the baseline, decided server-side.
   *
   * Not computed here: the confidence interval widens with how many types
   * are being judged together, and only the server knows that count. Two
   * implementations of the same test is two chances to disagree about
   * what the evidence says. Null when the type has too few samples to
   * judge at all — which is a different statement from "judged and could
   * not tell" (that is `indistinguishable`).
   */
  verdict: EdgeVerdict | null;
  deltaPp: number | null;
  marginPp: number | null;
  samplesNeeded: number | null;
}

/** 'beats' / 'worse' clear the baseline in one direction; 'indistinguishable' means not enough evidence, never "no edge". */
export type EdgeVerdict = 'beats' | 'worse' | 'indistinguishable';

/**
 * What the recorded outcomes have concluded about a signal type, cached by
 * the worker and read wherever a signal is shown. Fixed horizon and source
 * so the conclusion cannot be quietly picked to suit the answer.
 */
export interface SignalVerdict {
  signalType: SignalType;
  horizon: Horizon;
  source: string;
  verdict: EdgeVerdict;
  deltaPp: number;
  marginPp: number | null;
  sampleCount: number;
  hitPct: number;
  baselinePct: number;
  baselineSampleCount: number;
  comparisons: number;
  computedAt: number;
}

/**
 * What price did over the same horizon from an arbitrary moment — the
 * control every signal result must be read against. Measured the same way
 * as signal outcomes, over the period the outcomes span.
 */
export interface PerformanceBaseline {
  horizon: Horizon;
  sampleCount: number;
  positiveMovePct: number | null;
  medianMovePct: number | null;
  netPositiveMovePct: number | null;
  netNegativeMovePct: number | null;
  costPct: number;
  fromMs: number | null;
  toMs: number | null;
}

/**
 * Where the samples came from. 'live' is what the collector observed;
 * 'backfill' is the signal engine replayed over historical market data —
 * real, but weaker evidence (no liquidation history exists upstream, so two
 * of the nine rules cannot fire in it at all). Never averaged together
 * unless the reader explicitly asks for 'all'.
 */
export type PerformanceSource = 'live' | 'backfill' | 'all';

export const PERFORMANCE_SOURCES: readonly PerformanceSource[] = ['live', 'backfill', 'all'];

/** Rules that structurally cannot appear in replayed history — a zero here means "unmeasurable", not "never happens". */
export const UNREPLAYABLE_SIGNAL_TYPES: readonly SignalType[] = ['LONG_LIQUIDATION', 'SHORT_LIQUIDATION'];

export interface PerformanceResponse {
  horizon: Horizon;
  source: PerformanceSource;
  results: PerformanceResult[];
  baseline: PerformanceBaseline;
  /** How many results were judged together — what the margins were widened by. */
  comparisons: number;
}

/* ---------- Macro flow ---------- */

export interface StablecoinFlowWindow {
  changeUsd: number;
  changePct: number;
  /** The day actually compared against — rarely exactly N days back, so it's reported rather than assumed. */
  fromDay: string;
}

export interface StablecoinFlow {
  latestUsd: number;
  /** Day of the most recent data point. Daily data lags — this is not "today". */
  asOfDay: string;
  /** Null when history doesn't reach back far enough. */
  change7d: StablecoinFlowWindow | null;
  change30d: StablecoinFlowWindow | null;
}

/**
 * Whether the refresh behind `stablecoin` is actually working.
 *
 * Without this, a null reading means both "not refreshed yet" and "failing
 * on every attempt for a month", and the UI shows the same reassuring
 * placeholder for each. Null here means the job has never run at all.
 */
export interface FlowFetchState {
  lastAttemptAt: number | null;
  /** Null means it has never once succeeded. */
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface FlowResponse {
  /** Null until the worker's first refresh lands — read `fetch` to know whether that is still true. */
  stablecoin: StablecoinFlow | null;
  fetch: FlowFetchState | null;
}

/* ---------- Trade journal ---------- */

export type TradeSide = 'long' | 'short';
export type TradeStatus = 'open' | 'closed';

export interface Trade {
  id: string;
  chatId: string;
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  exitPrice: number | null;
  size: number | null;
  pnlPct: number | null;
  pnlUsd: number | null;
  status: TradeStatus;
  note: string | null;
  openedAt: number;
  closedAt: number | null;
}

export interface TradesResponse {
  trades: Trade[];
}

export interface TradeSummary {
  openCount: number;
  closedCount: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  /** Null when no closed trade recorded a size — "$0.00" would read as break-even rather than "not knowable". */
  totalPnlUsd: number | null;
  avgPnlPct: number | null;
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
  /** Optional because an API predating it sends nothing — absent is not the same as "no edge". */
  scoreEdge?: GemScoreEdge;
}

export interface GemScoreBand {
  key: string;
  label: string;
  min: number;
  max: number;
  sampleCount: number;
  positiveMovePct: number | null;
  medianMovePct: number | null;
  /** Share that moved up further than a round trip costs — the only win that pays. */
  netPositiveMovePct: number | null;
  liquidityCollapsePct: number | null;
  sufficientData: boolean;
}

/**
 * Whether a higher Gem Score precedes better outcomes at all.
 *
 * The scanner's weights shipped as starting points with no track record,
 * so until this existed the score could have been predicting nothing for
 * months with nothing to say so — and unlike the futures signals, this one
 * gets acted on with real money in an illiquid market.
 */
export interface GemScoreEdge {
  horizon: GemHorizon;
  costPct: number;
  bands: GemScoreBand[];
  /** Null while either end of the scale lacks the samples to be judged. */
  verdict: {
    verdict: EdgeVerdict;
    deltaPp: number;
    marginPp: number | null;
    samplesNeeded: number | null;
  } | null;
}

/* ---------- Operator status ---------- */

export interface StatusVersion {
  /** Null when no platform variable is set — not an error. */
  commit: string | null;
  commitSource: string | null;
  startedAt: number;
  uptimeMs: number;
  schema: { latest: string | null; appliedAt: number | null };
}

export interface StatusCollectorSymbol {
  symbol: string;
  /** Null when the collector has never produced a snapshot for this symbol — different from a very old one. */
  lastSnapshotAt: number | null;
  ageMs: number | null;
}

export interface StatusOutcomeHorizon {
  horizon: Horizon;
  resolved: number;
  pending: number;
  /** Zero against a large `pending` means the candles those signals need do not exist — waiting will not fix it. */
  resolvableNow: number;
  oldestPendingAt: number | null;
}

/** Futures 5m candles held for one symbol — the ruler every outcome is priced with. */
export interface StatusPricingCoverage {
  symbol: string;
  candles: number;
  earliestAt: number | null;
  latestAt: number | null;
}

export interface StatusStuckRow {
  symbol: string;
  timeframe: string;
  signalType: string;
  timestamp: number;
  source: string;
  /** Candles inside the exact window the resolver searches. Zero means waiting will not help. */
  candlesInWindow: number;
}

export interface StatusStuckHorizon {
  horizon: Horizon;
  rows: StatusStuckRow[];
}

/** An exact count of why a horizon's backlog is stuck, not a guess from its oldest rows. */
export interface StatusStuckCensus {
  horizon: Horizon;
  pending: number;
  withCandles: number;
  predateCandles: number;
  insideCoverageNoCandle: number;
}

export interface StatusOutcomeDiagnostics {
  pricingCandles: StatusPricingCoverage[];
  stuck: StatusStuckHorizon[];
  census: StatusStuckCensus[];
  serverTime: number;
}

/** The worker's live state, republished to the database because it has no HTTP surface. */
export interface StatusWorkerRuntime {
  service: string;
  lastHeartbeatAt: number;
  ageMs: number;
  connections: {
    spot: string;
    futures: string;
    liquidation: string;
  };
  /** Epoch millis of the last candle received per symbol, stamped before any processing. */
  symbolIngest: Record<string, number>;
  /**
   * How many chats the worker could send a health alert to. Zero means the
   * alerter is off — which changes what a quiet night proves. Optional
   * because an API predating the field sends nothing.
   */
  alertChatCount?: number;
}

export interface StatusJob {
  jobName: string;
  lastAttemptAt: number | null;
  /** Null means it has never once succeeded. */
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

/** A service that has no HTTP surface of its own and reports its build into the database at boot. */
export interface StatusService {
  service: string;
  commit: string | null;
  commitSource: string | null;
  startedAt: number;
}

export interface StatusResponse {
  version: StatusVersion;
  services: StatusService[];
  collector: StatusCollectorSymbol[];
  outcomes: StatusOutcomeHorizon[];
  jobs: StatusJob[];
  /** Null before the worker's first heartbeat — a cold start, not a failure. */
  worker: StatusWorkerRuntime | null;
  serverTime: number;
}
