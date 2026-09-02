import type { Pool } from 'pg';
import type { Logger } from '@crypto-signal/shared';
import {
  getAllJobHealth,
  getEnabledSymbols,
  getWorkerRuntime,
  HEARTBEAT_STALE_MS,
} from '@crypto-signal/db';

/**
 * Tells you the system broke, instead of waiting for you to look.
 *
 * The status page answers every question about what is wrong, and answers
 * none of them at three in the morning. This is the same set of checks,
 * pushed rather than pulled.
 *
 * The whole design problem is repetition. An alert that fires every cycle
 * while a symbol is down gets muted within a day, and a muted alert is
 * worse than none because it looks like coverage. So this reports
 * transitions only: it says a thing broke once, says it recovered once,
 * and is silent in between however long that is.
 */

/** A symbol older than this has stopped producing snapshots — matches /health and the status page. */
const STALE_SNAPSHOT_MS = 15 * 60_000;

/** Failures in a row with no success at all. One failure is an upstream hiccup. */
const BROKEN_JOB_FAILURES = 3;

export interface HealthIssue {
  /** Stable across cycles: it is what decides "already told you". */
  key: string;
  text: string;
}

export interface AlertDeps {
  pool: Pool;
  logger: Logger;
  notifier: { send: (chatId: string, text: string) => Promise<void> };
  chatIds: string[];
}

export async function collectHealthIssues(pool: Pool, nowMs: number = Date.now()): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];

  const runtime = await getWorkerRuntime(pool, undefined, nowMs);
  if (runtime !== null && runtime.ageMs > HEARTBEAT_STALE_MS) {
    // Reported first and alone: if the collector is gone, every check
    // below is describing a snapshot of a dead system, and listing them
    // all would bury the one fact that matters.
    return [
      {
        key: 'worker:heartbeat',
        text: `Worker ngừng gửi nhịp tim ${Math.round(runtime.ageMs / 60_000)} phút — tiến trình thu dữ liệu có thể đã chết.`,
      },
    ];
  }

  if (runtime !== null) {
    for (const [name, state] of Object.entries(runtime.connections)) {
      if (state !== 'open') {
        issues.push({ key: `ws:${name}`, text: `Kết nối ${name} tới Binance đang ở trạng thái "${state}".` });
      }
    }
  }

  const symbols = await getEnabledSymbols(pool);
  if (symbols.length > 0) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (symbol) symbol, extract(epoch from timestamp)*1000 AS ts
       FROM market_health_snapshots WHERE symbol = ANY($1)
       ORDER BY symbol, timestamp DESC`,
      [symbols],
    );
    for (const symbol of symbols) {
      const row = rows.find((r) => r.symbol === symbol);
      // A symbol that has never produced a snapshot is not alerted on: on a
      // fresh deploy that is every symbol, and an alert storm on first boot
      // is how someone learns to ignore the channel.
      if (!row) continue;
      const ageMs = nowMs - Number(row.ts);
      if (ageMs > STALE_SNAPSHOT_MS) {
        const ingestAgeMs = runtime?.symbolIngest[symbol] ? nowMs - runtime.symbolIngest[symbol] : null;
        const where =
          ingestAgeMs === null
            ? ''
            : ingestAgeMs <= STALE_SNAPSHOT_MS
              ? ' Nến vẫn về — lỗi ở phần xử lý.'
              : ' Nến cũng không về — lỗi phía kết nối.';
        issues.push({
          key: `symbol:${symbol}`,
          text: `${symbol} không có dữ liệu mới ${Math.round(ageMs / 60_000)} phút.${where}`,
        });
      }
    }
  }

  for (const job of await getAllJobHealth(pool)) {
    if (job.lastSuccessAt === null && job.consecutiveFailures >= BROKEN_JOB_FAILURES) {
      issues.push({
        key: `job:${job.jobName}`,
        text: `Tác vụ ${job.jobName} hỏng — ${job.consecutiveFailures} lần chạy, chưa lần nào thành công.`,
      });
    }
  }

  return issues;
}

/**
 * Diffs this cycle's issues against the last, and returns only what
 * changed. Pure so the transition rule can be tested without a database
 * or a Telegram token — it is the part that decides whether this feature
 * is useful or gets muted.
 */
export function diffIssues(
  previous: Set<string>,
  current: HealthIssue[],
): { opened: HealthIssue[]; closedKeys: string[] } {
  const currentKeys = new Set(current.map((i) => i.key));
  return {
    opened: current.filter((i) => !previous.has(i.key)),
    closedKeys: [...previous].filter((key) => !currentKeys.has(key)),
  };
}

export function formatOpened(issues: HealthIssue[]): string {
  const lines = issues.map((i) => `• ${i.text}`).join('\n');
  return `🔴 Hệ thống có vấn đề\n\n${lines}\n\nXem chi tiết ở trang Status.`;
}

export function formatClosed(keys: string[]): string {
  return `🟢 Đã trở lại bình thường: ${keys.join(', ')}`;
}

/**
 * In-memory rather than a table: a restart legitimately re-announces
 * whatever is still broken, and one duplicate message after a deploy is a
 * far smaller cost than a schema and a migration to avoid it.
 */
const announced = new Set<string>();

export async function runHealthAlertCycle(deps: AlertDeps, nowMs: number = Date.now()): Promise<void> {
  if (deps.chatIds.length === 0) return;

  const issues = await collectHealthIssues(deps.pool, nowMs);
  const { opened, closedKeys } = diffIssues(announced, issues);

  for (const issue of opened) announced.add(issue.key);
  for (const key of closedKeys) announced.delete(key);

  const messages = [
    ...(opened.length > 0 ? [formatOpened(opened)] : []),
    ...(closedKeys.length > 0 ? [formatClosed(closedKeys)] : []),
  ];

  for (const text of messages) {
    for (const chatId of deps.chatIds) {
      await deps.notifier.send(chatId, text).catch((err) => deps.logger.error({ err, chatId }, 'health alert send failed'));
    }
  }

  if (messages.length > 0) {
    deps.logger.info({ opened: opened.map((i) => i.key), closed: closedKeys }, 'health alert sent');
  }
}

/** Test seam: the announced set is module state so a cycle can remember across calls. */
export function __resetAnnouncedForTests(): void {
  announced.clear();
}
