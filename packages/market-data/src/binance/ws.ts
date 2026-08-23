import WebSocket from 'ws';
import type { Logger } from '@crypto-signal/shared';
import { computeBackoffDelay } from '../backoff.js';
import type { ConnectionStatus } from '../types.js';

export interface CombinedStreamOptions {
  baseWsUrl: string;
  streams: string[];
  onMessage: (streamName: string, data: unknown) => void;
  onStatus?: (status: ConnectionStatus) => void;
  logger: Logger;
  /** Force a reconnect if no message (including Binance's own ping) arrives within this window — protects against a socket that looks open but stopped delivering. */
  staleTimeoutMs?: number;
}

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
      this.emitStatus({ state: 'open' });
    });

    socket.on('message', (raw) => {
      this.armStaleWatch();
      try {
        const parsed = JSON.parse(raw.toString()) as { stream: string; data: unknown };
        this.opts.onMessage(parsed.stream, parsed.data);
      } catch (err) {
        this.opts.logger.error({ err }, 'failed to parse binance ws message');
      }
    });

    socket.on('error', (err) => {
      this.opts.logger.warn({ err }, 'binance ws error');
      this.emitStatus({ state: 'error', message: err.message });
    });

    socket.on('close', (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      this.clearStaleWatch();
      this.emitStatus({ state: 'closed', code, reason });
      if (!this.closedByUser) this.scheduleReconnect();
    });
  }

  close(): void {
    this.closedByUser = true;
    this.clearStaleWatch();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  private scheduleReconnect(): void {
    this.attempt += 1;
    const delayMs = computeBackoffDelay(this.attempt);
    this.emitStatus({ state: 'reconnecting', attempt: this.attempt, delayMs });
    this.opts.logger.warn({ attempt: this.attempt, delayMs }, 'reconnecting binance ws');
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  private armStaleWatch(): void {
    this.clearStaleWatch();
    const timeoutMs = this.opts.staleTimeoutMs ?? 60_000;
    this.staleTimer = setTimeout(() => {
      this.opts.logger.warn({ timeoutMs }, 'binance ws stale, forcing reconnect');
      this.socket?.terminate();
    }, timeoutMs);
  }

  private clearStaleWatch(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
  }

  private emitStatus(status: ConnectionStatus): void {
    this.opts.onStatus?.(status);
  }
}
