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

export type TradeSide = 'long' | 'short';
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
  totalPnlUsd: number;
  avgPnlPct: number | null;
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

  getSignals(limit = 10): Promise<{ signals: SignalRow[] }> {
    return this.get(`/api/signals?limit=${limit}`);
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
