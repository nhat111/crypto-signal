import type {
  StatusCollectorSymbol,
  StatusJob,
  StatusOutcomeHorizon,
  StatusPricingCoverage,
  StatusStuckRow,
  StatusVersion,
  StatusWorkerRuntime,
} from './types';

/**
 * The verdict rules for the status page, kept out of the JSX.
 *
 * These are the part that can be quietly wrong — a rule that never fires
 * makes the page a decoration, and one that fires on healthy data trains
 * the reader to ignore it. Pure functions so they can be tested against
 * the states they exist to catch.
 */
export type Verdict = 'ok' | 'warn' | 'bad' | 'idle';

/** A snapshot older than this means the collector is not keeping up — matches /health. */
export const STALE_SNAPSHOT_MS = 15 * 60_000;

/** One failure after a good run is an upstream hiccup; a streak is a bug. */
export const FAILURE_STREAK_WORTH_SHOWING = 3;

/**
 * A missing commit variable is a gap in what can be reported, not a fault
 * in the service, so it reads as neutral rather than red.
 */
export function versionVerdict(version: StatusVersion): Verdict {
  return version.commit === null ? 'idle' : 'ok';
}

export function collectorVerdict(rows: StatusCollectorSymbol[]): Verdict {
  if (rows.length === 0) return 'idle';
  const bad = rows.some((r) => r.lastSnapshotAt === null || (r.ageMs ?? 0) > STALE_SNAPSHOT_MS);
  return bad ? 'bad' : 'ok';
}

export function symbolVerdict(row: StatusCollectorSymbol): Verdict {
  if (row.lastSnapshotAt === null) return 'bad';
  return (row.ageMs ?? 0) > STALE_SNAPSHOT_MS ? 'bad' : 'ok';
}

/**
 * Work waiting is normal; work that cannot be done is not. A backlog being
 * chewed through and one that can never be priced both read as "lots
 * pending", and only the resolvable count tells them apart.
 */
export function isHorizonStuck(o: StatusOutcomeHorizon): boolean {
  return o.pending > 0 && o.resolvableNow === 0;
}

export function outcomesVerdict(outcomes: StatusOutcomeHorizon[]): Verdict {
  if (outcomes.some(isHorizonStuck)) return 'warn';
  return outcomes.some((o) => o.pending > 0) ? 'ok' : 'idle';
}

/** Never once succeeded. Not a slow start — this needs fixing. */
export function isJobBroken(job: StatusJob): boolean {
  return job.lastSuccessAt === null && job.consecutiveFailures > 0;
}

/** Worked before, failing now: the output looks live and is going stale. */
export function isJobFailing(job: StatusJob): boolean {
  return !isJobBroken(job) && job.consecutiveFailures >= FAILURE_STREAK_WORTH_SHOWING;
}

export function jobsVerdict(jobs: StatusJob[]): Verdict {
  if (jobs.some(isJobBroken)) return 'bad';
  if (jobs.some(isJobFailing)) return 'warn';
  return jobs.length === 0 ? 'idle' : 'ok';
}

/* ------------------------------------------------------------------ */
/* Why a backlog cannot be priced                                      */
/* ------------------------------------------------------------------ */

/**
 * `resolvableNow: 0` against `pending: 244` says the backlog is stuck but
 * not why, and the causes need different fixes. This turns the two
 * diagnostic queries into one of them.
 */
export type OutcomeDiagnosis =
  /** Nothing waiting. */
  | 'clear'
  /** No futures 5m candle exists at all — nothing can ever be priced. */
  | 'no-pricing-candles'
  /** The stuck signals are older than the oldest candle held for their symbol. */
  | 'signals-predate-candles'
  /** The signals sit inside the stored range, but their own windows are empty. */
  | 'candle-gap'
  /** Candles are there and the tracker is working through them. */
  | 'draining'
  /** Candles are there, yet the resolver reports none resolvable — the two disagree. */
  | 'query-fault';

export function diagnoseStuckOutcomes(
  coverage: StatusPricingCoverage[],
  rows: StatusStuckRow[],
  resolvableNow: number,
): OutcomeDiagnosis {
  if (rows.length === 0) return 'clear';

  const totalCandles = coverage.reduce((sum, c) => sum + c.candles, 0);
  if (totalCandles === 0) return 'no-pricing-candles';

  // Rows with an empty window are the finding, even when others alongside
  // them are fine: those can never be priced, no matter how long the
  // tracker runs. Reporting "draining" because *some* row is workable is
  // the reassuring lie — the queue drains to a floor and stays there.
  const dead = rows.filter((r) => r.candlesInWindow === 0);

  if (dead.length === 0) {
    // Every window holds candles, so every row is one the resolver should
    // be able to take. If it says it can take none, the diagnostic and the
    // resolver read the same window and disagree — a bug in one of them,
    // worth saying so rather than blaming the data.
    return resolvableNow > 0 ? 'draining' : 'query-fault';
  }

  // Either the candles start after these signals, or there is a hole where
  // they sit. A backfill fixes the first; only the collector fixes the
  // second, so the two must not be reported as one.
  const allPredate = dead.every((row) => {
    const held = coverage.find((c) => c.symbol === row.symbol);
    return held === undefined || held.earliestAt === null || row.timestamp < held.earliestAt;
  });

  return allPredate ? 'signals-predate-candles' : 'candle-gap';
}

export const DIAGNOSIS_TEXT: Record<OutcomeDiagnosis, { tone: Verdict; headline: string; detail: string }> = {
  clear: {
    tone: 'ok',
    headline: 'Không còn gì chờ chấm',
    detail: 'Mọi tín hiệu đã đủ tuổi đều đã có kết quả.',
  },
  'no-pricing-candles': {
    tone: 'bad',
    headline: 'Không có nến 5m nào trong kho',
    detail:
      'Kết quả được chấm bằng nến 5m futures. Không có cây nào thì không tín hiệu nào chấm được. Kiểm tra biến TIMEFRAMES trên Railway có chứa 5m không, và worker có đang chạy không.',
  },
  'signals-predate-candles': {
    tone: 'warn',
    headline: 'Tín hiệu có trước nến',
    detail:
      'Mấy tín hiệu này ra đời trước cây nến 5m cũ nhất đang lưu — thường là do replay viết tín hiệu 30 ngày trước trong khi nến chỉ có từ lúc worker bắt đầu chạy. Chờ thêm không giải quyết được; phải backfill nến 5m cho đúng khoảng đó.',
  },
  'candle-gap': {
    tone: 'bad',
    headline: 'Thiếu nến ở đúng khoảng cần chấm',
    detail:
      'Tín hiệu nằm trong khoảng thời gian đã có nến, nhưng cửa sổ chấm của riêng nó lại trống — tức là kho nến có lỗ hổng. Thường do worker mất kết nối một đoạn.',
  },
  draining: {
    tone: 'ok',
    headline: 'Đang chấm dần',
    detail: 'Nến có sẵn và bộ chấm đang xử lý. Chờ vài lượt là hàng đợi vơi.',
  },
  'query-fault': {
    tone: 'bad',
    headline: 'Nến có mà vẫn báo không chấm được',
    detail:
      'Cửa sổ chấm có nến, nhưng bộ chấm báo không lấy được dòng nào. Hai chỗ này soi cùng một cửa sổ nên đây là lỗi trong mã, không phải thiếu dữ liệu — báo lại để sửa.',
  },
};

/* ------------------------------------------------------------------ */
/* Worker heartbeat and sockets                                        */
/* ------------------------------------------------------------------ */

/**
 * Three missed beats, matching HEARTBEAT_STALE_MS in packages/db. A GC
 * pause or a slow query should not be reported as a dead worker, and the
 * two sides must not disagree about where the line is.
 */
export const HEARTBEAT_STALE_MS = 3 * 60_000;

/**
 * A stale heartbeat does not mean the sockets are down — it means their
 * reported state is old and must not be read as current. Saying "socket
 * closed" from a row nobody has updated in an hour is inventing an
 * observation, which is the failure this whole page exists to avoid.
 */
export function workerVerdict(worker: StatusWorkerRuntime | null): Verdict {
  if (worker === null) return 'idle';
  if (worker.ageMs > HEARTBEAT_STALE_MS) return 'bad';
  return Object.values(worker.connections).every((state) => state === 'open') ? 'ok' : 'warn';
}

/** True when the row is too old for its connection states to mean anything. */
export function isHeartbeatStale(worker: StatusWorkerRuntime): boolean {
  return worker.ageMs > HEARTBEAT_STALE_MS;
}

export function connectionVerdict(state: string, stale: boolean): Verdict {
  if (stale) return 'idle';
  if (state === 'open') return 'ok';
  if (state === 'connecting') return 'warn';
  return 'bad';
}
