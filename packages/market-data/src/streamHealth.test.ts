import { describe, expect, it } from 'vitest';
import { KLINE_STREAM_STALE_MS, MAX_PER_STREAM_RECONNECTS, shouldForceReconnect, staleStreams } from './streamHealth.js';

describe('staleStreams', () => {
  const NOW = 1_800_000_000_000;
  const MIN = 60_000;
  const subscribed = ['btcusdt@kline_15m', 'ethusdt@kline_15m', 'hypeusdt@kline_15m'];

  const seen = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it('finds the one quiet symbol inside a busy socket', () => {
    // The exact production shape: BTC and ETH chatting every couple of
    // seconds while HYPE has delivered nothing for hours. The
    // connection-level watchdog is fed by the first two and never fires,
    // which is how one symbol sat silent for seventeen hours with every
    // connection reporting "open".
    const quiet = staleStreams(
      subscribed,
      seen({
        'btcusdt@kline_15m': NOW - 2000,
        'ethusdt@kline_15m': NOW - 3000,
        'hypeusdt@kline_15m': NOW - 17 * 60 * MIN,
      }),
      NOW,
      KLINE_STREAM_STALE_MS,
    );
    expect(quiet).toEqual(['hypeusdt@kline_15m']);
  });

  it('says nothing when every stream is delivering', () => {
    const quiet = staleStreams(
      subscribed,
      seen({
        'btcusdt@kline_15m': NOW - 2000,
        'ethusdt@kline_15m': NOW - 3000,
        'hypeusdt@kline_15m': NOW - 4000,
      }),
      NOW,
      KLINE_STREAM_STALE_MS,
    );
    expect(quiet).toEqual([]);
  });

  it('holds its tongue exactly at the timeout and speaks past it', () => {
    const at = seen({ 'btcusdt@kline_15m': NOW - KLINE_STREAM_STALE_MS });
    const past = seen({ 'btcusdt@kline_15m': NOW - KLINE_STREAM_STALE_MS - 1 });
    expect(staleStreams(['btcusdt@kline_15m'], at, NOW, KLINE_STREAM_STALE_MS)).toEqual([]);
    expect(staleStreams(['btcusdt@kline_15m'], past, NOW, KLINE_STREAM_STALE_MS)).toEqual(['btcusdt@kline_15m']);
  });

  it('does not judge a stream that has no clock yet', () => {
    // Before the socket opens nothing has been given a starting point.
    // Reading that as stale would put the connection in a reconnect loop
    // before it ever had a chance to deliver.
    expect(staleStreams(subscribed, new Map(), NOW, KLINE_STREAM_STALE_MS)).toEqual([]);
  });

  it('is switched off entirely when no timeout is set', () => {
    // Liquidation streams are genuinely sparse — nobody being liquidated is
    // the normal state — so applying this to them would terminate a healthy
    // socket on a fixed cycle, forever.
    const ancient = seen({ 'btcusdt@forceOrder': NOW - 5 * 60 * MIN });
    expect(staleStreams(['btcusdt@forceOrder'], ancient, NOW, 0)).toEqual([]);
    expect(staleStreams(['btcusdt@forceOrder'], ancient, NOW, -1)).toEqual([]);
  });

  it('only ever names streams that were actually subscribed', () => {
    // A leftover timestamp from a previous subscription must not be
    // reported as a fault on a connection that no longer carries it.
    const withGhost = seen({
      'btcusdt@kline_15m': NOW - 1000,
      'solusdt@kline_15m': NOW - 60 * 60 * MIN,
    });
    expect(staleStreams(['btcusdt@kline_15m'], withGhost, NOW, KLINE_STREAM_STALE_MS)).toEqual([]);
  });

  it('names every quiet stream, not just the first', () => {
    // A whole symbol goes quiet on all its timeframes at once, and the log
    // has to show that rather than one arbitrary stream of it.
    const quiet = staleStreams(
      ['hypeusdt@kline_5m', 'hypeusdt@kline_15m', 'btcusdt@kline_15m'],
      seen({
        'hypeusdt@kline_5m': NOW - 60 * MIN,
        'hypeusdt@kline_15m': NOW - 60 * MIN,
        'btcusdt@kline_15m': NOW - 1000,
      }),
      NOW,
      KLINE_STREAM_STALE_MS,
    );
    expect(quiet).toEqual(['hypeusdt@kline_5m', 'hypeusdt@kline_15m']);
  });

  it('leaves enough room that a healthy kline stream is never killed', () => {
    // Binance pushes kline updates every second or two on every timeframe,
    // in-progress candles included, so the window is hundreds of missed
    // updates rather than a quiet patch — and it must stay well under the
    // 15-minute staleness the rest of the system judges symbols on, or the
    // reconnect would arrive after the damage was already reported.
    expect(KLINE_STREAM_STALE_MS).toBeGreaterThanOrEqual(60_000);
    expect(KLINE_STREAM_STALE_MS).toBeLessThan(15 * MIN);
  });
});

describe('shouldForceReconnect', () => {
  it('reconnects while there is reason to think it will help', () => {
    expect(shouldForceReconnect(['hypeusdt@kline_15m'], 0)).toBe(true);
    expect(shouldForceReconnect(['hypeusdt@kline_15m'], MAX_PER_STREAM_RECONNECTS - 1)).toBe(true);
  });

  it('stops once reconnecting has plainly not helped', () => {
    // Reconnecting rebuilds the whole socket, so every symbol on it takes a
    // gap. Doing that every five minutes forever because one delisted
    // symbol will never come back trades a silent one-symbol outage for a
    // repeating all-symbol one, which is not a fix.
    expect(shouldForceReconnect(['hypeusdt@kline_15m'], MAX_PER_STREAM_RECONNECTS)).toBe(false);
    expect(shouldForceReconnect(['hypeusdt@kline_15m'], MAX_PER_STREAM_RECONNECTS + 10)).toBe(false);
  });

  it('never reconnects when nothing is quiet', () => {
    expect(shouldForceReconnect([], 0)).toBe(false);
    expect(shouldForceReconnect([], MAX_PER_STREAM_RECONNECTS - 1)).toBe(false);
  });

  it('gives the outage more than one chance', () => {
    // One reconnect is a coin flip against a transient server-side drop;
    // giving up after a single try would leave a recoverable stream dead.
    expect(MAX_PER_STREAM_RECONNECTS).toBeGreaterThan(1);
  });
});
