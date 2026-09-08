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
  openedAt: number;
  closedAt: number | null;
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

export interface LookupDTO {
  query: string;
  timeframe: string;
  result:
    | {
        kind: 'exchange';
        symbol: string;
        timeframe: string;
        technical: {
          barCount: number;
          lastPrice: number;
          rsi14: number | null;
          trend: { direction: string; separationPct: number } | null;
          atrPct: number | null;
          support: number | null;
          resistance: number | null;
          rangePositionPct: number | null;
          missing: string[];
        };
        fundamentals: { unknowns: string[] };
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

  watchGem(chatId: string, symbol: string): Promise<{ watch: GemWatchDTO }> {
    return this.post('/api/watches', { chatId, symbol });
  }

  getWatches(chatId: string): Promise<{ watches: GemWatchDTO[] }> {
    return this.get(`/api/watches/${chatId}`);
  }

  unwatch(chatId: string, id: string): Promise<{ closed: true }> {
    return this.post(`/api/watches/${id}/close`, { chatId });
  }

  openTrade(chatId: string, symbol: string, side: TradeSide, entryPrice: number, size: number | null): Promise<{ trade: TradeDTO }> {
    return this.post('/api/journal', { chatId, symbol, side, entryPrice, size });
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

  registerUser(chatId: string, username: string | undefined): Promise<{ settings: BotSettings }> {
    return this.post('/api/bot/register', { chatId, username });
  }

  getSettings(chatId: string): Promise<{ settings: BotSettings }> {
    return this.get(`/api/bot/settings/${chatId}`);
  }

  setAlertsEnabled(chatId: string, enabled: boolean): Promise<{ settings: BotSettings }> {
    return this.post(`/api/bot/settings/${chatId}`, { alertsEnabled: enabled });
  }
}
