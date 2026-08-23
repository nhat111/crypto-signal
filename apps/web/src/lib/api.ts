import type {
  Horizon,
  OverviewResponse,
  PerformanceResponse,
  PerformanceResult,
  SignalsResponse,
  SignalType,
  SymbolDetailResponse,
  Timeframe,
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

export function getPerformance(horizon: Horizon): Promise<PerformanceResponse> {
  return fetchJson<PerformanceResponse>(`/api/performance?horizon=${horizon}`);
}

export function getPerformanceForType(
  signalType: SignalType,
  horizon: Horizon,
): Promise<PerformanceResult> {
  return fetchJson<PerformanceResult>(`/api/performance/${signalType}?horizon=${horizon}`);
}
