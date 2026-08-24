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

export interface SymbolResponse {
  symbol: string;
  timeframe: string;
  latest: LatestSymbolState | null;
  signals: SignalRow[];
}

export interface BotSettings {
  chatId: string;
  alertsEnabled: boolean;
  minSeverity: string;
  symbols: string[];
}

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`API GET ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API POST ${path} failed: ${res.status}`);
    return (await res.json()) as T;
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
