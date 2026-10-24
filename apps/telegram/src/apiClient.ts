import type { FlywheelResponseDTO, SectorLabelDTO, SectorsResponseDTO } from './sectorsFormat.js';
import type { AirdropsResponseDTO, FarmDTO } from './airdrop.js';
import type { BaselineReportInput } from '@crypto-signal/shared';
/**
 * Every command hits apps/api over HTTP — the bot never touches Postgres
 * or Binance directly (rule 8 "Telegram và Web dùng chung API/domain
 * layer", rule "Không để Telegram/web gọi trực tiếp Binance"). Types here
 * are DTOs mirroring the API's JSON shape, not re-implemented logic.
 */

export interface OverviewRow {
  symbol: string;
  timeframe: string;
  timestamp: number;
  priceClose: number;
  priceChangePct: number;
  /** Null for futures-only symbols (no Binance Spot listing) — Health Score needs a spot leg to compare against. */
  healthScore: number | null;
  healthStatus: string | null;
  riskScore: number;
  dataQualityScore: number;
}

export interface OverviewResponse {
  symbols: string[];
  timeframes: string[];
  rows: OverviewRow[];
}

export interface LatestSymbolState extends OverviewRow {
  spotCvd: number | null;
  futuresCvd: number;
  openInterest: number;
  fundingRatePct: number;
  liquidationLongUsd: number;
  liquidationShortUsd: number;
}

export interface SignalRow {
  signalId: string;
  symbol: string;
  timeframe: string;
  signalType: string;
  severity: string;
  confidence: number;
  timestamp: number;
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
}

/** 20-period Bollinger Band (2 stddev) — reference range, not a buy/sell instruction. Null until 20 closed candles exist. */
export interface PriceLevels {
  upper: number;
  middle: number;
  lower: number;
}

export interface SymbolResponse {
  symbol: string;
  timeframe: string;
  latest: LatestSymbolState | null;
  signals: SignalRow[];
  priceLevels: PriceLevels | null;
}

export interface BotSettings {
  chatId: string;
  alertsEnabled: boolean;
  minSeverity: string;
  symbols: string[];
  /** Null until set with /risk. Absent from APIs older than the risk profile. */
  accountUsd?: number | null;
  riskPct?: number;
}

export interface GemRow {
  scanId: string;
  chainId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  dexId: string;
  url: string | null;
  scannedAt: number;
  gemScore: number;
  riskScore: number;
  reasons: string[];
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  /** Fully diluted valuation — same field the small-cap ceiling gate uses. */
  fdvUsd: number | null;
  priceChange24hPct: number | null;
  ageDays: number | null;
  safetyVerdict: string | null;
  safetyFlags: string[] | null;
}

export interface GemWatchDTO {
  id: string;
  chatId: string;
  chainId: string;
  tokenAddress: string;
  symbol: string;
  entryPrice: number;
  entryLiquidityUsd: number | null;
  stopLossPct: number;
  /**
   * Optional for the same reason the web types are: the bot and the API
   * deploy separately, so for a stretch after each release the bot runs
   * new code against the old payload. Null additionally means a watch
   * armed before migration 023, which has no trailing stop at all.
   */
  trailingStopPct?: number | null;
  trailingArmPct?: number | null;
  peakPrice?: number | null;
  takeProfitPct: number;
  liquidityCollapsePct: number;
  riskScoreAlert: number;
  status: 'active' | 'triggered' | 'closed';
  createdAt: number;
}

/** Thrown for a non-2xx /api/watches response so callers can read the API's own error message instead of a generic "failed: 4xx". */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type TradeSide = 'long' | 'short' | 'spot';

/** Mirrors the API's own check — this app has no dependency on the db package. */
export function isTradeSide(value: unknown): value is TradeSide {
  return value === 'spot' || value === 'long' || value === 'short';
}
export type TradeStatus = 'open' | 'closed';

export interface TradeDTO {
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
  /** Optional: an API that predates these columns sends neither. */
  source?: string | null;
  thesis?: string | null;
  /** Optional: an API that predates stops sends none of these. */
  stopPrice?: number | null;
  rMultiple?: number | null;
  riskUsd?: number | null;
  openedAt: number;
  closedAt: number | null;
}

/** Mirrors /api/breakouts (API_CONTRACT.md); only the fields read here. */
export interface SpotBreakoutDTO {
  symbol: string;
  barOpenTime: number;
  entry: number;
  stop: number;
  trail: number;
  status: 'open' | 'stop' | 'trail';
  exitTime: number | null;
  returnPct: number | null;
  rMultiple: number | null;
}

export interface SpotBreakoutsDTO {
  enabled: boolean;
  run: { day: string; regimeUp: boolean; btcClose: number; btcEma50: number; btcEma200: number } | null;
  open: SpotBreakoutDTO[];
  closed: SpotBreakoutDTO[];
  stats: { closed: number; wins: number; avgR: number | null };
  minClosed: number;
  replay: { trades: number; winPct: number; avgR: number };
}

export interface SetupDTO {
  symbol: string;
  kind: 'pullback' | 'breakout_retest';
  detectedAt: number;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  status: 'open' | 'target' | 'stop' | 'expired';
  rMultiple: number | null;
  /** Absent from APIs older than the OKX fallback. */
  exchange?: 'binance' | 'okx';
  /** Absent from APIs older than coin setups (all core then). */
  cohort?: 'core' | 'watchlist' | 'scan';
}

export interface TrendDTO {
  symbol: string;
  lastCloseTime: number;
  lastClose: number;
  trend: 'up' | 'down' | 'sideways';
  event: 'up_broken' | 'down_broken' | null;
  previousTrend: 'up' | 'down' | 'sideways' | null;
  aboveEma: boolean | null;
  emaPeriod: number;
  reasons: string[];
}

export type CoinFlowDTO =
  | 'spot_led'
  | 'spot_and_leverage'
  | 'leverage_led'
  | 'short_squeeze'
  | 'short_covering'
  | 'up_unconfirmed'
  | 'spot_selling'
  | 'shorts_building'
  | 'long_unwind'
  | 'down_unconfirmed'
  | 'accumulation'
  | 'distribution'
  | 'leverage_building'
  | 'quiet';

/** One coin from the wide scan (/api/coins). Percent fields are already in percent. */
export interface CoinScanDTO {
  day: string;
  symbol: string;
  volumeRank: number;
  futuresSymbol: string | null;
  close: number;
  ret7d: number | null;
  ret30d: number | null;
  rs7d: number | null;
  rs30d: number | null;
  rsAboveSma20: boolean | null;
  downDayExcess: number | null;
  downDays: number;
  takerSkew7d: number | null;
  oiChange7dPct: number | null;
  fundingAvg7dPct: number | null;
  flow: CoinFlowDTO;
  reasons: string[];
  unknowns: string[];
  /** DefiLlama drivers; absent from older APIs, null when none were read. */
  fundamentals?: { chain: { name: string } | null; protocol: { name: string } | null; bull: string[]; bear: string[]; unknowns: string[] } | null;
}

export interface CoinsResponseDTO {
  enabled: boolean;
  day: string | null;
  /** Absent from APIs older than the OKX fallback, which only ever read Binance. */
  exchange?: 'binance' | 'okx' | null;
  rows: CoinScanDTO[];
  fetch: { lastSuccessAt: number | null; consecutiveFailures: number; lastError: string | null } | null;
}

export interface TradeSummaryDTO {
  openCount: number;
  closedCount: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  /** Null when no closed trade recorded a size — "$0.00" would read as break-even rather than "not knowable". */
  totalPnlUsd: number | null;
  avgPnlPct: number | null;
  /** Optional: an API that predates stops sends neither. */
  avgR?: number | null;
  rCount?: number;
}

/** The last morning digest as sent (/api/bot/digest/:chatId). `text` is Telegram HTML. */
export interface StoredDigestDTO {
  day: string;
  sentAt: number;
  text: string;
  /** True when it is this chat's own message, with its "Của bạn" section. */
  personal: boolean;
}

export interface StablecoinFlowWindowDTO {
  changeUsd: number;
  changePct: number;
  fromDay: string;
}

export interface StablecoinFlowDTO {
  latestUsd: number;
  asOfDay: string;
  change7d: StablecoinFlowWindowDTO | null;
  change30d: StablecoinFlowWindowDTO | null;
}

export interface LookupContextDTO {
  coinScan: CoinScanDTO | null;
  coinScanDay: string | null;
  coinScanSize: number;
  sectors: Array<{ categoryId: string; name: string; label: SectorLabelDTO; rank: number; change7dPct: number }>;
  flywheel: { name: string; symbol: string | null; holdersRevenue30dUsd: number; holdersRevenueChangePct: number | null; yieldPct: number | null } | null;
}

export interface LookupDTO {
  query: string;
  timeframe: string;
  /** What the worker stored about the coin; absent from older APIs, null when it could not be read. */
  context?: LookupContextDTO | null;
  result:
    | {
        kind: 'exchange';
        symbol: string;
        /** 'binance', or the fallback exchange when Binance refused the server. Absent from older APIs. */
        source?: string;
        timeframe: string;
        technical: {
          barCount: number;
          lastPrice: number;
          rsi14: number | null;
          trend: { direction: string; separationPct: number } | null;
          atrPct: number | null;
          /** A bare number from an older API; the level with its distance from a newer one. */
          support: number | { price: number; distancePct: number } | null;
          resistance: number | { price: number; distancePct: number } | null;
          rangePositionPct: number | null;
          missing: string[];
        };
        fundamentals: { unknowns: string[] };
        /** The 1D levels the setup detector watches. Absent from older APIs, null when unreadable. */
        daily?: {
          trend: 'up' | 'down' | 'sideways';
          aboveEma: boolean | null;
          emaPeriod: number;
          swingLow: { price: number; distancePct: number } | null;
          swingHigh: { price: number; distancePct: number } | null;
          watch: string[];
        } | null;
        /** The same read on 1h/4h/1d. Absent from older APIs. */
        timeframes?: Array<{ timeframe: string; trend: { direction: string; separationPct: number } | null; rsi14: number | null; changePct: number | null }>;
      }
    | {
        kind: 'onchain';
        fundamentals: {
          symbol: string;
          name: string;
          chainId: string;
          dexId: string;
          priceUsd: number | null;
          liquidityUsd: number | null;
          fdvUsd: number | null;
          volume24hUsd: number | null;
          ageDays: number | null;
          liquidityToFdvPct: number | null;
          safetyVerdict: string | null;
          safetyFlags: string[];
          topHolderPct: number | null;
          lpLocked: boolean | null;
          unknowns: string[];
        };
      };
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`API GET ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  private async send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // /api/watches and /api/journal reply with a plain-language {error}
      // on 4xx (already watching, unknown trade, etc.) that's worth
      // showing the user directly rather than a generic "failed: 409".
      const parsed = await res.json().catch(() => undefined);
      const message = parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : `API ${method} ${path} failed: ${res.status}`;
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as T;
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('POST', path, body);
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>('PATCH', path, body);
  }

  getOverview(): Promise<OverviewResponse> {
    return this.get('/api/overview');
  }

  getSymbol(symbol: string, timeframe = '15m'): Promise<SymbolResponse> {
    return this.get(`/api/symbols/${symbol}?timeframe=${timeframe}`);
  }

  getSignals(limit = 10, timeframes: string[] = []): Promise<{ signals: SignalRow[] }> {
    const filter = timeframes.length > 0 ? `&timeframe=${encodeURIComponent(timeframes.join(','))}` : '';
    return this.get(`/api/signals?limit=${limit}${filter}`);
  }

  /**
   * Which timeframes the worker will actually push alerts on, or null when
   * it has not said.
   *
   * Read from /status rather than from this app's own environment: the
   * arming lives on the worker, and a second copy of that setting here
   * could disagree with it — which is precisely the confusion being fixed.
   */
  async getArmedTimeframes(): Promise<string[] | null> {
    try {
      const status = await this.get<{ worker?: { alertTimeframes?: { armed?: string[] } | null } | null }>('/api/status');
      const armed = status.worker?.alertTimeframes?.armed;
      return Array.isArray(armed) ? armed : null;
    } catch {
      // Never fatal: /signals still answers, it just says it could not
      // narrow the list.
      return null;
    }
  }

  /**
   * Returns the API's own failure reason on a 404, because for a lookup
   * that reason IS the answer — "no pool on any DEX we cover" and "404"
   * send somebody to two different places.
   */
  async lookup(q: string, timeframe?: string): Promise<{ ok: true; data: LookupDTO } | { ok: false; reason: string }> {
    const qs = new URLSearchParams({ q });
    if (timeframe) qs.set('timeframe', timeframe);
    const res = await fetch(`${this.baseUrl}/api/lookup?${qs.toString()}`);
    const body = (await res.json().catch(() => null)) as { error?: string } | LookupDTO | null;
    if (!res.ok) {
      const reason = body && 'error' in body && typeof body.error === 'string' ? body.error : `API trả về ${res.status}`;
      return { ok: false, reason };
    }
    return { ok: true, data: body as LookupDTO };
  }

  getGems(limit = 10): Promise<{ gems: GemRow[] }> {
    return this.get(`/api/gems?limit=${limit}`);
  }

  /**
   * Typed as the shared report's input rather than a full GemPerformance
   * mirror: this call exists only to be read out loud, and the bot has no
   * business asserting fields it never looks at.
   */
  getGemPerformance(horizon = '7d'): Promise<BaselineReportInput> {
    return this.get(`/api/gems/performance?horizon=${encodeURIComponent(horizon)}`);
  }

  watchGem(chatId: string, symbol: string): Promise<{ watch: GemWatchDTO }> {
    return this.post('/api/watches', { chatId, symbol });
  }

  getWatches(chatId: string): Promise<{ watches: GemWatchDTO[] }> {
    return this.get(`/api/watches/${chatId}`);
  }

  unwatch(chatId: string, id: string): Promise<{ closed: true }> {
    return this.post(`/api/watches/${id}/close`, { chatId });
  }

  getSectors(): Promise<SectorsResponseDTO> {
    return this.get('/api/sectors');
  }

  getFlywheel(limit = 30): Promise<FlywheelResponseDTO> {
    return this.get(`/api/flywheel?limit=${limit}`);
  }

  getAirdrops(limit = 200): Promise<AirdropsResponseDTO> {
    return this.get(`/api/airdrops?limit=${limit}`);
  }

  getFarms(chatId: string): Promise<{ farms: FarmDTO[] }> {
    return this.get(`/api/airdrops/farms?chatId=${encodeURIComponent(chatId)}`);
  }

  logFarm(chatId: string, name: string, costUsd: number, note: string | null): Promise<{ farm: FarmDTO }> {
    return this.post('/api/airdrops/farms/log', { chatId, name, costUsd, note });
  }

  openTrade(
    chatId: string,
    symbol: string,
    side: TradeSide,
    entryPrice: number,
    size: number | null,
    source: string | null = null,
    thesis: string | null = null,
    stopPrice: number | null = null,
  ): Promise<{ trade: TradeDTO }> {
    return this.post('/api/journal', { chatId, symbol, side, entryPrice, size, source, thesis, stopPrice });
  }

  /** Sets, moves or (with null) clears the stop on a logged trade. */
  setStop(id: string, stopPrice: number | null): Promise<{ trade: TradeDTO }> {
    return this.patch(`/api/journal/${id}`, { stopPrice });
  }

  getTrend(): Promise<{ trends: TrendDTO[] }> {
    return this.get('/api/trend');
  }

  getCoins(): Promise<CoinsResponseDTO> {
    return this.get('/api/coins');
  }

  getBreakouts(limit = 10): Promise<SpotBreakoutsDTO> {
    return this.get(`/api/breakouts?limit=${limit}`);
  }

  getSetups(limit = 10): Promise<{ setups: SetupDTO[]; minResolved: number }> {
    return this.get(`/api/setups?limit=${limit}`);
  }

  closeTrade(id: string, exitPrice: number): Promise<{ trade: TradeDTO }> {
    return this.patch(`/api/journal/${id}`, { exitPrice });
  }

  getTrades(chatId: string, limit = 20): Promise<{ trades: TradeDTO[] }> {
    return this.get(`/api/journal?chatId=${encodeURIComponent(chatId)}&limit=${limit}`);
  }

  getOpenTrade(chatId: string, symbol: string): Promise<TradeDTO | undefined> {
    return this.get<{ trades: TradeDTO[] }>(
      `/api/journal?chatId=${encodeURIComponent(chatId)}&status=open&limit=200`,
    ).then((res) => res.trades.find((t) => t.symbol === symbol));
  }

  getTradeSummary(chatId: string): Promise<{ summary: TradeSummaryDTO }> {
    return this.get(`/api/journal/summary?chatId=${encodeURIComponent(chatId)}`);
  }

  getFlow(): Promise<{ stablecoin: StablecoinFlowDTO | null }> {
    return this.get('/api/flow');
  }

  getDigest(chatId: string): Promise<{ digest: StoredDigestDTO | null }> {
    return this.get(`/api/bot/digest/${encodeURIComponent(chatId)}`);
  }

  registerUser(chatId: string, username: string | undefined): Promise<{ settings: BotSettings }> {
    return this.post('/api/bot/register', { chatId, username });
  }

  getSettings(chatId: string): Promise<{ settings: BotSettings }> {
    return this.get(`/api/bot/settings/${chatId}`);
  }

  setAlertsEnabled(chatId: string, enabled: boolean): Promise<{ settings: BotSettings }> {
    return this.post(`/api/bot/settings/${chatId}`, { alertsEnabled: enabled });
  }

  /** `accountUsd: null` forgets the account; an omitted `riskPct` keeps the stored one. */
  setRiskProfile(chatId: string, accountUsd: number | null, riskPct?: number): Promise<{ settings: BotSettings }> {
    return this.post(`/api/bot/settings/${chatId}`, riskPct === undefined ? { accountUsd } : { accountUsd, riskPct });
  }
}
