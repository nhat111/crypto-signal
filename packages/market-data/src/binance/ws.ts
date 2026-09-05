import WebSocket from 'ws';
import type { Logger } from '@crypto-signal/shared';
import { computeBackoffDelay } from '../backoff.js';
import { shouldForceReconnect, staleStreams } from '../streamHealth.js';
import type { ConnectionStatus } from '../types.js';

export interface CombinedStreamOptions {
  /** Identifies this connection in logs — several run at once (spot klines, futures klines, liquidations) and they are otherwise indistinguishable. */
  name: string;
  baseWsUrl: string;
  streams: string[];
  onMessage: (streamName: string, data: unknown) => void;
  onStatus?: (status: ConnectionStatus) => void;
  logger: Logger;
  /**
   * Force a reconnect if nothing at all arrives within this window —
   * protects against a socket that looks open but stopped delivering.
   *
   * Must stay comfortably above Binance's server-side ping interval, or it
   * will kill healthy connections on sparse streams. See DEFAULT_STALE_TIMEOUT_MS.
   */
  staleTimeoutMs?: number;
  /**
   * Force a reconnect when an *individual* subscribed stream goes quiet,
   * even though the connection as a whole is busy.
   *
   * The connection-level watchdog above cannot see this: four symbols
   * share one socket, and any one of them chatting keeps the timer alive
   * while another delivers nothing. That is how a symbol stayed silent
   * for seventeen hours with every connection reporting "open".
   *
   * Only set this for streams that are continuously pushed (klines).
   * Leave it unset for `@forceOrder`, where silence is the normal state.
   */
  perStreamStaleMs?: number;
}

/**
 * Ten minutes, not one.
 *
 * The watchdog is reset by *any* traffic, including Binance's periodic
 * server ping. But some streams are naturally sparse — `@forceOrder` only
 * fires when someone is actually liquidated, which can easily be quiet for
 * minutes — so the only thing keeping such a connection visibly alive is
 * that ping. A timeout shorter than the ping interval therefore terminates
 * perfectly healthy sockets on a fixed cycle, forever.
 *
 * Missing data is caught properly elsewhere (candle-gap detection feeding
 * the data-quality score), so this only needs to be a last-resort net for a
 * truly dead socket, and it is far better for it to be late than wrong.
 */
const DEFAULT_STALE_TIMEOUT_MS = 10 * 60_000;

/** How often the per-stream check runs. Cheap: a map lookup per subscribed stream. */
const PER_STREAM_CHECK_INTERVAL_MS = 60_000;

/**
 * Wraps a single Binance "combined stream" WebSocket connection
 * (`/stream?streams=a/b/c`) with automatic reconnect + exponential backoff
 * (spec §29 "WebSocket reconnect", §37 test scenario 8).
 *
 * Reconnect policy itself lives in backoff.ts as a pure function so it's
 * unit-testable without a socket; this class is the thin stateful shell
 * around it.
 */
export class CombinedStreamClient {
  private socket: WebSocket | undefined;
  private attempt = 0;
  private closedByUser = false;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private perStreamTimer: ReturnType<typeof setInterval> | undefined;
  private perStreamReconnects = 0;
  private gaveUpOnStreams = false;
  private readonly lastSeenByStream = new Map<string, number>();

  constructor(private readonly opts: CombinedStreamOptions) {}

  connect(): void {
    this.closedByUser = false;
    const url = `${this.opts.baseWsUrl}/stream?streams=${this.opts.streams.join('/')}`;
    this.emitStatus({ state: 'connecting' });
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on('open', () => {
      this.attempt = 0;
      this.armStaleWatch();
      this.armPerStreamWatch();
      this.emitStatus({ state: 'open' });
      this.opts.logger.info({ stream: this.opts.name, streamCount: this.opts.streams.length }, 'binance ws open');
    });

    socket.on('message', (raw) => {
      this.armStaleWatch();
      try {
        const parsed = JSON.parse(raw.toString()) as { stream: string; data: unknown };
        // Stamped per stream, not just per socket: this is the record that
        // makes a single quiet symbol visible inside a busy connection.
        this.lastSeenByStream.set(parsed.stream, Date.now());
        this.opts.onMessage(parsed.stream, parsed.data);
      } catch (err) {
        this.opts.logger.error({ err, stream: this.opts.name }, 'failed to parse binance ws message');
      }
    });

    // Control frames never surface as 'message', so without these a sparse
    // stream looks silent even while the server is actively keeping it alive.
    socket.on('ping', () => this.armStaleWatch());
    socket.on('pong', () => this.armStaleWatch());

    socket.on('error', (err) => {
      this.opts.logger.warn({ err, stream: this.opts.name }, 'binance ws error');
      this.emitStatus({ state: 'error', message: err.message });
    });

    socket.on('close', (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      this.clearStaleWatch();
      this.clearPerStreamWatch();
      this.emitStatus({ state: 'closed', code, reason });
      if (!this.closedByUser) this.scheduleReconnect();
    });
  }

  close(): void {
    this.closedByUser = true;
    this.clearStaleWatch();
    this.clearPerStreamWatch();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    const delayMs = computeBackoffDelay(this.attempt);
    this.emitStatus({ state: 'reconnecting', attempt: this.attempt, delayMs });
    this.opts.logger.warn({ stream: this.opts.name, attempt: this.attempt, delayMs }, 'reconnecting binance ws');
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  private armStaleWatch(): void {
    this.clearStaleWatch();
    const timeoutMs = this.opts.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;
    this.staleTimer = setTimeout(() => {
      this.opts.logger.warn({ stream: this.opts.name, timeoutMs }, 'binance ws stale, forcing reconnect');
      this.socket?.terminate();
    }, timeoutMs);
  }

  private clearStaleWatch(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
  }

  /**
   * Every stream starts its clock at connection time, so a socket that has
   * just opened is never judged on silence it has not had time to break.
   */
  private armPerStreamWatch(): void {
    this.clearPerStreamWatch();
    const timeoutMs = this.opts.perStreamStaleMs ?? 0;
    if (timeoutMs <= 0) return;

    const openedAt = Date.now();
    for (const stream of this.opts.streams) this.lastSeenByStream.set(stream, openedAt);

    this.perStreamTimer = setInterval(() => {
      const quiet = staleStreams(this.opts.streams, this.lastSeenByStream, Date.now(), timeoutMs);

      if (quiet.length === 0) {
        if (this.gaveUpOnStreams) {
          this.opts.logger.info({ stream: this.opts.name }, 'binance ws streams delivering again');
        }
        this.perStreamReconnects = 0;
        this.gaveUpOnStreams = false;
        return;
      }

      if (!shouldForceReconnect(quiet, this.perStreamReconnects)) {
        // Said once, not every minute: the symbol already reads as stale
        // on /status, and a line per minute would bury the log it sits in.
        if (!this.gaveUpOnStreams) {
          this.gaveUpOnStreams = true;
          this.opts.logger.error(
            { stream: this.opts.name, quiet, attempts: this.perStreamReconnects },
            'binance ws streams still silent after repeated reconnects — treating as an upstream outage and leaving the socket alone',
          );
        }
        return;
      }

      this.perStreamReconnects += 1;
      // Named, because "which symbol stopped" is the question this exists
      // to answer and the reconnect alone would not answer it.
      this.opts.logger.warn(
        { stream: this.opts.name, quiet, timeoutMs, attempt: this.perStreamReconnects },
        'binance ws streams silent while the connection is busy, forcing reconnect',
      );
      this.socket?.terminate();
    }, PER_STREAM_CHECK_INTERVAL_MS);
  }

  private clearPerStreamWatch(): void {
    if (this.perStreamTimer) clearInterval(this.perStreamTimer);
    this.perStreamTimer = undefined;
  }

  private emitStatus(status: ConnectionStatus): void {
    this.opts.onStatus?.(status);
  }
}
