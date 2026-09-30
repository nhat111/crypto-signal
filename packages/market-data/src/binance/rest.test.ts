import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceRestClient, BinanceRestError } from './rest.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function response(status: number, headers: Record<string, string> = {}, body: unknown = []): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function client(): BinanceRestClient {
  return new BinanceRestClient({ baseUrl: 'https://fapi.example', klinesPath: '/fapi/v1/klines', logger });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('BinanceRestClient ban handling', () => {
  it('fails fast on a long Retry-After instead of sleeping through it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(418, { 'retry-after': '39877' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(client().get('/fapi/v1/klines')).rejects.toBeInstanceOf(BinanceRestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends nothing while banned, and resumes once the ban lifts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(418, { 'retry-after': '3600' }));
    vi.stubGlobal('fetch', fetchMock);
    const rest = client();

    await expect(rest.get('/fapi/v1/klines')).rejects.toThrow(/banned until/);
    await expect(rest.get('/fapi/v1/openInterest')).rejects.toThrow(/skipped.*banned until/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3600_000 + 1);
    fetchMock.mockResolvedValueOnce(response(200, {}, [1]));
    await expect(rest.get('/fapi/v1/klines')).resolves.toEqual([1]);
  });

  it('still waits out a short Retry-After and retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(response(200, {}, ['ok']));
    vi.stubGlobal('fetch', fetchMock);

    const pending = client().get('/fapi/v1/klines');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual(['ok']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
