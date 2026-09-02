import { describe, expect, it, vi, beforeEach } from 'vitest';
import { diffIssues, formatOpened, formatClosed, runHealthAlertCycle, __resetAnnouncedForTests } from './healthAlerts.js';

const issue = (key: string, text = key) => ({ key, text });

describe('diffIssues', () => {
  it('reports a problem the first time and never again while it lasts', () => {
    // The rule the whole feature lives or dies on. An alert that repeats
    // every cycle gets muted, and a muted alert looks like coverage while
    // providing none.
    const first = diffIssues(new Set(), [issue('symbol:BTCUSDT')]);
    expect(first.opened.map((i) => i.key)).toEqual(['symbol:BTCUSDT']);

    const second = diffIssues(new Set(['symbol:BTCUSDT']), [issue('symbol:BTCUSDT')]);
    expect(second.opened).toEqual([]);
    expect(second.closedKeys).toEqual([]);
  });

  it('reports recovery once, when the problem stops being listed', () => {
    const { closedKeys } = diffIssues(new Set(['ws:futures']), []);
    expect(closedKeys).toEqual(['ws:futures']);
  });

  it('handles one problem clearing while another is still open', () => {
    const d = diffIssues(new Set(['ws:spot', 'job:stablecoin_flow']), [issue('job:stablecoin_flow')]);
    expect(d.opened).toEqual([]);
    expect(d.closedKeys).toEqual(['ws:spot']);
  });

  it('reports a new problem appearing beside an existing one', () => {
    const d = diffIssues(new Set(['ws:spot']), [issue('ws:spot'), issue('symbol:ETHUSDT')]);
    expect(d.opened.map((i) => i.key)).toEqual(['symbol:ETHUSDT']);
    expect(d.closedKeys).toEqual([]);
  });
});

describe('message text', () => {
  it('lists every open problem rather than only the first', () => {
    const text = formatOpened([issue('a', 'BTCUSDT đứng'), issue('b', 'Kết nối futures đóng')]);
    expect(text).toContain('BTCUSDT đứng');
    expect(text).toContain('Kết nối futures đóng');
  });

  it('names what recovered', () => {
    expect(formatClosed(['ws:spot'])).toContain('ws:spot');
  });
});

describe('runHealthAlertCycle', () => {
  beforeEach(() => __resetAnnouncedForTests());

  const poolWith = (issuesReady: boolean) =>
    ({
      query: vi.fn(async (sql: string) => {
        if (sql.includes('market_health_snapshots')) {
          // One symbol, stale by an hour when we want an issue.
          return { rows: issuesReady ? [{ symbol: 'BTCUSDT', ts: Date.now() - 60 * 60_000 }] : [] };
        }
        if (sql.includes('job_health')) return { rows: [] };
        if (sql.includes('worker_runtime')) return { rows: [] };
        return { rows: [{ symbol: 'BTCUSDT' }] };
      }),
    }) as never;

  it('does no work at all when no chat is configured', async () => {
    // Asserting only that nothing was sent is vacuous — with no chat ids
    // the send loop never runs regardless. The guard exists to skip the
    // queries, so that is what this checks: no database work every cycle
    // for messages nobody would receive.
    const notifier = { send: vi.fn(async () => {}) };
    const pool = poolWith(true);
    await runHealthAlertCycle({ pool, logger: console as never, notifier, chatIds: [] });
    expect(notifier.send).not.toHaveBeenCalled();
    expect((pool as unknown as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled();
  });

  it('sends once for a problem, then stays quiet on the next cycle', async () => {
    const notifier = { send: vi.fn(async () => {}) };
    const deps = { pool: poolWith(true), logger: { info: vi.fn(), error: vi.fn() } as never, notifier, chatIds: ['1'] };

    await runHealthAlertCycle(deps);
    expect(notifier.send).toHaveBeenCalledTimes(1);

    await runHealthAlertCycle(deps);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it('does not let one chat failing stop the others', async () => {
    // A blocked bot or a deleted chat must not swallow the alert for
    // everybody else.
    const notifier = {
      send: vi.fn(async (chatId: string) => {
        if (chatId === '1') throw new Error('chat not found');
      }),
    };
    const logger = { info: vi.fn(), error: vi.fn() } as never;
    await runHealthAlertCycle({ pool: poolWith(true), logger, notifier, chatIds: ['1', '2'] });
    expect(notifier.send).toHaveBeenCalledTimes(2);
  });
});
