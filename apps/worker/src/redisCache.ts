import { Redis } from 'ioredis';
import type { MarketSnapshot } from '@crypto-signal/indicators';
import type { HealthResult, RiskResult } from '@crypto-signal/health-engine';
import type { Signal } from '@crypto-signal/signal-engine';

export interface CachedState {
  snapshot: MarketSnapshot;
  health: HealthResult;
  risk: RiskResult;
  signals: Signal[];
  updatedAt: number;
}

/**
 * Latest-snapshot cache only (ASSUMPTIONS.md §12) — Postgres stays the
 * source of truth for history. A cache miss/failure never breaks the
 * pipeline: callers fall back to reading Postgres.
 */
export class SnapshotCache {
  private readonly client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.client.on('error', () => {
      // Swallow — cache is best-effort, errors are surfaced via logger by the caller's try/catch instead of crashing the process.
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  private key(symbol: string, timeframe: string): string {
    return `snapshot:${symbol}:${timeframe}`;
  }

  async set(state: CachedState): Promise<void> {
    const key = this.key(state.snapshot.symbol, state.snapshot.timeframe);
    await this.client.set(key, JSON.stringify(state), 'EX', 60 * 60 * 6);
  }

  async get(symbol: string, timeframe: string): Promise<CachedState | undefined> {
    const raw = await this.client.get(this.key(symbol, timeframe));
    return raw ? (JSON.parse(raw) as CachedState) : undefined;
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }
}
