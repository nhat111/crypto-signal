/**
 * Which individual streams on a combined socket have gone quiet.
 *
 * The existing watchdog measures the *connection*, and that is why one
 * symbol could stop for seventeen hours while /status reported every
 * Binance connection open. BTC, ETH, SOL and HYPE share one futures
 * socket; BTC alone sends something every couple of seconds, so the
 * connection-level timer was being fed continuously and never once fired
 * while HYPE delivered nothing at all. The only self-healing mechanism in
 * the collector was structurally blind to the failure it most needed to
 * catch — a per-symbol outage inside a healthy socket.
 *
 * Pure, for the same reason backoff.ts is: this is the policy, and it has
 * to be testable without opening a socket.
 */
export function staleStreams(
  subscribed: readonly string[],
  lastSeenAt: ReadonlyMap<string, number>,
  nowMs: number,
  timeoutMs: number,
): string[] {
  if (timeoutMs <= 0) return [];
  return subscribed.filter((stream) => {
    const seen = lastSeenAt.get(stream);
    // A stream with no timestamp at all has not been given a starting
    // point, which only happens before the socket opened. Treating that as
    // stale would force a reconnect loop on a connection that has not had
    // its chance yet.
    if (seen === undefined) return false;
    return nowMs - seen > timeoutMs;
  });
}

/**
 * How long a kline stream may say nothing before it is presumed dead.
 *
 * Binance pushes kline updates every second or two on *every* timeframe,
 * in-progress candles included, so even a 4h stream is continuously
 * chatty. Five minutes is therefore hundreds of missed updates, not a
 * quiet patch.
 *
 * Deliberately not applied to `@forceOrder`: liquidations are genuinely
 * sparse — nobody being liquidated is the normal state — and a per-stream
 * timeout there would terminate a healthy socket on a fixed cycle,
 * forever. Only the caller knows which of its streams are continuous, so
 * this is opt-in rather than a default.
 */
export const KLINE_STREAM_STALE_MS = 5 * 60_000;

/**
 * How many times a per-stream outage may force a reconnect before the
 * collector stops trying.
 *
 * Reconnecting rebuilds the *whole* socket, so every symbol on it takes a
 * gap. That is a fair price for recovering a stalled stream and a terrible
 * one for a stream that is never coming back — a delisted symbol, or one
 * Binance simply does not serve, would otherwise interrupt the healthy
 * symbols every five minutes forever. Trading a silent one-symbol outage
 * for a repeating all-symbol one is not a fix.
 *
 * After this many tries the conclusion is upstream, not ours: the socket
 * is left alone and the symbol shows as stale on /status, which is the
 * honest reading.
 */
export const MAX_PER_STREAM_RECONNECTS = 3;

export function shouldForceReconnect(
  quiet: readonly string[],
  consecutiveAttempts: number,
  max: number = MAX_PER_STREAM_RECONNECTS,
): boolean {
  return quiet.length > 0 && consecutiveAttempts < max;
}
