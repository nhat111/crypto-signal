export interface BackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  /** Deterministic in tests by injecting a fixed jitter fn; production uses Math.random. */
  jitter: () => number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: Math.random,
};

/**
 * Full-jitter exponential backoff (attempt is 1-based). Pure function so the
 * WS reconnect policy is unit-testable without opening a socket (spec §37
 * item "WebSocket reconnect").
 */
export function computeBackoffDelay(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.5 + opts.jitter() * 0.5));
}
