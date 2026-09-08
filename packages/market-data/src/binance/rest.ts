import type { Logger } from '@crypto-signal/shared';
import type { RawKline } from '../normalizer.js';

export class BinanceRestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
    /** Epoch ms when an IP ban (418) is expected to lift, if known. */
    public readonly bannedUntilMs: number | null = null,
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
}

/**
 * IP bans are per outbound IP and last minutes→days. Retrying inside a
 * single get() during a ban is how a backfill turns a 2-minute ban into
 * a multi-hour one (Binance escalates repeat offenders). Shared across
 * clients on the same base so spot-klines and whatever else hits that
 * host all stop until the ban window ends.
 */
const ipBanUntilByHost = new Map<string, number>();

/** Test-only: clear recorded bans between cases. */
export function resetIpBanState(): void {
  ipBanUntilByHost.clear();
}

/** Test-only / diagnostics. */
export function getIpBanUntil(baseUrl: string): number | null {
  const until = ipBanUntilByHost.get(hostKey(baseUrl));
  return until && until > Date.now() ? until : null;
}

function hostKey(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function noteIpBan(baseUrl: string, untilMs: number): void {
  const key = hostKey(baseUrl);
  const prev = ipBanUntilByHost.get(key) ?? 0;
  if (untilMs > prev) ipBanUntilByHost.set(key, untilMs);
}

/**
 * Binance sends Retry-After as seconds on 429/418. Body on 418 may also
 * carry `data.retryAfter` (epoch ms) or "banned until <epochMs>" in msg.
 */
export function parseBanUntilMs(
  headers: { get(name: string): string | null },
  body: unknown,
  nowMs = Date.now(),
): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds) && asSeconds >= 0) {
      return nowMs + asSeconds * 1000;
    }
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) return asDate;
  }

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const data = record['data'];
    if (data && typeof data === 'object') {
      const retryAfterMs = Number((data as Record<string, unknown>)['retryAfter']);
      if (Number.isFinite(retryAfterMs) && retryAfterMs > 1_000_000_000_000) return retryAfterMs;
      if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return nowMs + retryAfterMs * 1000;
    }
    const msg = record['msg'];
    if (typeof msg === 'string') {
      const match = msg.match(/banned until\s+(\d{10,})/i);
      if (match) {
        const raw = Number(match[1]);
        // Binance uses epoch milliseconds in the sample message.
        if (raw > 1_000_000_000_000) return raw;
        if (raw > 1_000_000_000) return raw * 1000;
      }
    }
  }

  // Unknown duration: fail closed for a short cool-off so a tight retry
  // loop cannot immediately re-hit the IP. Prefer Retry-After when present.
  return nowMs + 60_000;
}

/** Cap a single 429 sleep so one request cannot hang the worker for an hour. */
const MAX_429_DELAY_MS = 60_000;

/**
 * Thin typed wrapper over Binance's REST endpoints actually used by this
 * app (spec §29 "Rate-limit handling"):
 *
 * - **429** (weight / raw request limit): back off using Retry-After when
 *   present, otherwise exponential, then retry up to maxRetries.
 * - **418** (IP ban): do **not** retry. Record banned-until for this host
 *   and throw. Further get() calls short-circuit until the ban lifts —
 *   polling through a ban escalates duration (2 minutes → days).
 *
 * Every other 4xx/5xx is thrown immediately — those are programming/data
 * errors, not transient rate limiting, and retrying them would hide a bug.
 */
export class BinanceRestClient {
  private readonly baseUrl: string;
  private readonly klinesPath: string;
  private readonly logger: Logger;
  private readonly maxRetries: number;

  constructor(opts: RestClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.klinesPath = opts.klinesPath;
    this.logger = opts.logger;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    this.throwIfBanned(path);

    let attempt = 0;
    for (;;) {
      attempt += 1;
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) {
        return (await res.json()) as T;
      }

      const body = await safeJson(res);

      // IP ban: stop. Do not retry — that is how bans escalate.
      if (res.status === 418) {
        const bannedUntilMs = parseBanUntilMs(res.headers, body);
        noteIpBan(this.baseUrl, bannedUntilMs ?? Date.now() + 60_000);
        this.logger.warn(
          {
            status: 418,
            path,
            bannedUntilMs,
            bannedForMs: bannedUntilMs ? bannedUntilMs - Date.now() : null,
          },
          'binance IP banned (418) — pausing REST to this host until ban lifts',
        );
        throw new BinanceRestError(
          `Binance REST 418 on ${path} (IP banned${bannedUntilMs ? ` until ${new Date(bannedUntilMs).toISOString()}` : ''})`,
          418,
          body,
          bannedUntilMs,
        );
      }

      if (res.status === 429 && attempt <= this.maxRetries) {
        const retryAfterHeader = res.headers.get('retry-after');
        const parsed = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1000 * 2 ** attempt;
        const delayMs = Math.min(
          MAX_429_DELAY_MS,
          Number.isFinite(parsed) && parsed > 0 ? parsed : 1000 * 2 ** attempt,
        );
        this.logger.warn({ status: 429, path, attempt, delayMs }, 'binance rate limited (429), backing off');
        await sleep(delayMs);
        continue;
      }

      throw new BinanceRestError(`Binance REST ${res.status} on ${path}`, res.status, body);
    }
  }

  private throwIfBanned(path: string): void {
    const until = getIpBanUntil(this.baseUrl);
    if (until === null) return;
    this.logger.warn(
      { path, bannedUntilMs: until, remainingMs: until - Date.now() },
      'binance REST skipped — host still IP-banned',
    );
    throw new BinanceRestError(
      `Binance REST skipped on ${path} (IP banned until ${new Date(until).toISOString()})`,
      418,
      { bannedUntilMs: until },
      until,
    );
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
