import { describe, expect, it, beforeEach } from 'vitest';
import { parseBanUntilMs, resetIpBanState, getIpBanUntil, BinanceRestClient } from './rest.js';

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

describe('parseBanUntilMs', () => {
  const now = 1_700_000_000_000;

  it('uses Retry-After seconds', () => {
    expect(parseBanUntilMs(headers({ 'retry-after': '120' }), null, now)).toBe(now + 120_000);
  });

  it('uses body data.retryAfter epoch ms', () => {
    const until = now + 3_600_000;
    expect(parseBanUntilMs(headers({}), { data: { retryAfter: until } }, now)).toBe(until);
  });

  it('parses banned-until epoch from msg', () => {
    const until = now + 600_000;
    expect(
      parseBanUntilMs(headers({}), { msg: `Way too much request weight used; IP banned until ${until}.` }, now),
    ).toBe(until);
  });

  it('falls back to 60s cool-off when duration is unknown', () => {
    expect(parseBanUntilMs(headers({}), null, now)).toBe(now + 60_000);
  });
});

describe('IP ban gate', () => {
  beforeEach(() => resetIpBanState());

  it('records ban from a 418 and short-circuits later gets', async () => {
    const until = Date.now() + 60_000;
    let fetches = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response(JSON.stringify({ msg: `IP banned until ${until}`, data: { retryAfter: until } }), {
        status: 418,
        headers: { 'content-type': 'application/json', 'retry-after': '60' },
      });
    }) as typeof fetch;

    const logger = { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined };
    const client = new BinanceRestClient({
      baseUrl: 'https://api.binance.com',
      klinesPath: '/api/v3/klines',
      logger: logger as never,
    });

    await expect(client.get('/api/v3/klines', { symbol: 'BTCUSDT', interval: '5m' })).rejects.toMatchObject({
      status: 418,
    });
    expect(fetches).toBe(1);
    expect(getIpBanUntil('https://api.binance.com')).not.toBeNull();

    await expect(client.get('/api/v3/klines', { symbol: 'ETHUSDT', interval: '5m' })).rejects.toMatchObject({
      status: 418,
    });
    // Second call must not touch the network.
    expect(fetches).toBe(1);

    globalThis.fetch = originalFetch;
  });
});
