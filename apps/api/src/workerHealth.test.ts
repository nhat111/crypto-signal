import { describe, expect, it } from 'vitest';
import { evaluateWorkerHealth } from './workerHealth.js';

const runtime = (ageMs: number, connections: Record<string, string> = {}) => ({
  service: 'worker',
  lastHeartbeatAt: 1_800_000_000_000 - ageMs,
  ageMs,
  connections: { spot: 'open', futures: 'open', liquidation: 'open', ...connections },
  symbolIngest: {},
    alertChatCount: 0,
});

const STALE = 180_000;

describe('evaluateWorkerHealth', () => {
  it('does not redden a cold start', () => {
    // A first deploy must not look broken; collector freshness already
    // reports "this system has produced no data".
    const check = evaluateWorkerHealth(null, STALE);
    expect(check.status).toBe('no_heartbeat_yet');
    expect(check.healthy).toBe(true);
  });

  it('is ok when the beat is fresh and every socket is open', () => {
    const check = evaluateWorkerHealth(runtime(30_000), STALE);
    expect(check.status).toBe('ok');
    expect(check.healthy).toBe(true);
  });

  it('reports a closed socket without reddening the endpoint', () => {
    // The process is alive and saying so. Waking someone for a reconnecting
    // feed is how a probe stops being believed.
    const check = evaluateWorkerHealth(runtime(30_000, { futures: 'closed' }), STALE);
    expect(check.status).toBe('degraded');
    expect(check.healthy).toBe(true);
    expect(check.connections?.futures).toBe('closed');
  });

  it('reddens only on a stale heartbeat', () => {
    const check = evaluateWorkerHealth(runtime(STALE + 1), STALE);
    expect(check.status).toBe('stale');
    expect(check.healthy).toBe(false);
  });

  it('tolerates two missed beats', () => {
    // 60s interval, 180s threshold: a GC pause or a slow query is not a
    // dead worker, and a probe that says it is will be muted.
    expect(evaluateWorkerHealth(runtime(120_000), STALE).status).toBe('ok');
    expect(evaluateWorkerHealth(runtime(STALE), STALE).status).toBe('ok');
  });

  it('still reports stale when every socket last said open', () => {
    // The trap: a process that died with "open" in the row would otherwise
    // keep claiming health forever.
    const check = evaluateWorkerHealth(runtime(10 * 60_000), STALE);
    expect(check.status).toBe('stale');
    expect(check.healthy).toBe(false);
  });
});
