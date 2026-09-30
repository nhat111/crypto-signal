import type { Logger } from '@crypto-signal/shared';
import type { RawKline } from '../normalizer.js';

export class BinanceRestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'BinanceRestError';
  }
}

export interface RestClientOptions {
  baseUrl: string;
  /** '/api/v3/klines' for spot, '/fapi/v1/klines' for futures — the two bases share every other shape (ASSUMPTIONS.md §1). */
  klinesPath: string;
  logger: Logger;
  maxRetries?: number;
  /** Longest Retry-After worth sleeping through; anything longer is treated as a ban. */
  maxBackoffMs?: number;
}

/**
 * A Retry-After longer than this is not a pause, it is a ban. Binance bans
 * IPs for minutes up to days, and shared free-tier egress IPs (Render,
 * Koyeb…) arrive already banned by someone else's traffic — one deploy saw
 * a futures 418 asking for 11 hours. Sleeping through that hung the
 * worker's boot backfill, so the WebSocket collector and the heartbeat
 * never started and /status could only say "not reported".
 */
const DEFAULT_MAX_BACKOFF_MS = 60_000;

/**
 * Thin typed wrapper over Binance's REST endpoints actually used by this
 * app (spec §29 "Rate-limit handling"): backs off on HTTP 429 (rate limit)
 * and 418 (IP ban) using the `Retry-After` header when present, otherwise
 * exponential backoff. Every other 4xx/5xx is thrown immediately — those
 * are programming/data errors, not transient rate limiting, and retrying
 * them would hide a real bug.
 *
 * A ban (Retry-After beyond maxBackoffMs) fails fast instead, and every
 * call until it lifts throws without touching the network: Binance
 * lengthens a ban for requests sent during it, and the callers already
 * treat a failed REST call as "live data will catch up".
 */
export class BinanceRestClient {
  private readonly baseUrl: string;
  private readonly klinesPath: string;
  private readonly logger: Logger;
  private readonly maxRetries: number;
  private readonly maxBackoffMs: number;
  private bannedUntil = 0;

  constructor(opts: RestClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.klinesPath = opts.klinesPath;
    this.logger = opts.logger;
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    if (Date.now() < this.bannedUntil) {
      throw new BinanceRestError(
        `Binance REST skipped on ${path}: IP banned until ${new Date(this.bannedUntil).toISOString()}`,
        418,
        undefined,
      );
    }

    let attempt = 0;
    for (;;) {
      attempt += 1;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        return (await res.json()) as T;
      }

      const isRateLimited = res.status === 429 || res.status === 418;
      if (isRateLimited && attempt <= this.maxRetries) {
        const retryAfterHeader = res.headers.get('retry-after');
        const delayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1000 * 2 ** attempt;
        if (delayMs > this.maxBackoffMs) {
          this.bannedUntil = Date.now() + delayMs;
          const until = new Date(this.bannedUntil).toISOString();
          this.logger.error(
            { status: res.status, path, delayMs, bannedUntil: until },
            'binance IP ban — REST calls paused until it lifts, WebSocket collection continues',
          );
          throw new BinanceRestError(`Binance REST ${res.status} on ${path}: IP banned until ${until}`, res.status, undefined);
        }
        this.logger.warn(
          { status: res.status, path, attempt, delayMs },
          'binance rate limited, backing off',
        );
        await sleep(delayMs);
        continue;
      }

      const body = await safeJson(res);
      throw new BinanceRestError(`Binance REST ${res.status} on ${path}`, res.status, body);
    }
  }

  async getKlines(
    symbol: string,
    interval: string,
    opts: { limit?: number; startTime?: number; endTime?: number } = {},
  ): Promise<RawKline[]> {
    return this.get<RawKline[]>(this.klinesPath, {
      symbol,
      interval,
      limit: opts.limit,
      startTime: opts.startTime,
      endTime: opts.endTime,
    });
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
