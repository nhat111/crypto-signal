import type {
  GemHorizon,
  GemPerformance,
  GemsResponse,
  Horizon,
  OverviewResponse,
  PerformanceResponse,
  PerformanceResult,
  FlowResponse,
  SignalsResponse,
  SignalType,
  SymbolDetailResponse,
  Timeframe,
  Trade,
  TradesResponse,
  TradeSide,
  TradeSummary,
} from './types';

/**
 * The only place apps/web is allowed to know an HTTP base URL — every data
 * call in this app must go through here, never straight to Binance/Postgres
 * (API_CONTRACT.md "Notes for the web app").
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
  } catch {
    throw new ApiError(`Could not reach the API at ${API_BASE_URL}. Is it running?`);
  }
  if (!res.ok) {
    throw new ApiError(`${path} responded with ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

async function sendJson<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Could not reach the API at ${API_BASE_URL}. Is it running?`);
  }
  if (!res.ok) {
    // Journal/watch routes reply with a plain-language {error} on 4xx —
    // worth surfacing directly instead of a generic "responded with 409".
    const parsed = await res.json().catch(() => undefined);
    const message = parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : `${path} responded with ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export function getOverview(): Promise<OverviewResponse> {
  return fetchJson<OverviewResponse>('/api/overview');
}

export function getSymbolDetail(
  symbol: string,
  timeframe: Timeframe,
  limit = 200,
): Promise<SymbolDetailResponse> {
  const params = new URLSearchParams({ timeframe, limit: String(limit) });
  return fetchJson<SymbolDetailResponse>(`/api/symbols/${symbol}?${params.toString()}`);
}

export interface SignalsFilter {
  symbol?: string;
  timeframe?: Timeframe;
  signalType?: SignalType;
  limit?: number;
}

export function getSignals(filter: SignalsFilter = {}): Promise<SignalsResponse> {
  const params = new URLSearchParams();
  if (filter.symbol) params.set('symbol', filter.symbol);
  if (filter.timeframe) params.set('timeframe', filter.timeframe);
  if (filter.signalType) params.set('signalType', filter.signalType);
  if (filter.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return fetchJson<SignalsResponse>(`/api/signals${qs ? `?${qs}` : ''}`);
}

export function getGems(params: { chain?: string; minScore?: number; limit?: number } = {}): Promise<GemsResponse> {
  const qs = new URLSearchParams();
  if (params.chain) qs.set('chain', params.chain);
  if (params.minScore !== undefined) qs.set('minScore', String(params.minScore));
  if (params.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return fetchJson<GemsResponse>(`/api/gems${query ? `?${query}` : ''}`);
}

export function getGemPerformance(horizon: GemHorizon): Promise<GemPerformance> {
  return fetchJson<GemPerformance>(`/api/gems/performance?horizon=${horizon}`);
}

export function getPerformance(horizon: Horizon): Promise<PerformanceResponse> {
  return fetchJson<PerformanceResponse>(`/api/performance?horizon=${horizon}`);
}

export function getFlow(): Promise<FlowResponse> {
  return fetchJson<FlowResponse>('/api/flow');
}

export function getPerformanceForType(
  signalType: SignalType,
  horizon: Horizon,
): Promise<PerformanceResult> {
  return fetchJson<PerformanceResult>(`/api/performance/${signalType}?horizon=${horizon}`);
}

/* ---------- Trade journal ---------- */

// The web dashboard has no login, so there's no per-visitor identity to
// scope entries by — everyone using the web UI shares this one sentinel,
// same idea as bot_users being scoped by chat_id for Telegram entries.
const WEB_CHAT_ID = 'web';

export function getTrades(limit = 200): Promise<TradesResponse> {
  return fetchJson<TradesResponse>(`/api/journal?limit=${limit}`);
}

export function getTradeSummary(): Promise<{ summary: TradeSummary }> {
  return fetchJson<{ summary: TradeSummary }>('/api/journal/summary');
}

export interface CreateTradeInput {
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  size: number | null;
  note: string | null;
}

export function createTrade(input: CreateTradeInput): Promise<{ trade: Trade }> {
  return sendJson('POST', '/api/journal', { chatId: WEB_CHAT_ID, ...input });
}

export interface UpdateTradeInput {
  symbol?: string;
  side?: TradeSide;
  entryPrice?: number;
  exitPrice?: number | null;
  size?: number | null;
  note?: string | null;
}

export function updateTrade(id: string, patch: UpdateTradeInput): Promise<{ trade: Trade }> {
  return sendJson('PATCH', `/api/journal/${id}`, patch);
}

export function deleteTrade(id: string): Promise<{ deleted: true }> {
  return sendJson('DELETE', `/api/journal/${id}`);
}
