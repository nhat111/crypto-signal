import type {
  StatusCollectorSymbol,
  StatusJob,
  StatusOutcomeHorizon,
  StatusPricingCoverage,
  StatusService,
  StatusStuckCensus,
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
 * not why, and the causes need different fixes. `diagnoseFromCensus`
 * below picks one of these from a count of the whole backlog.
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

/* ------------------------------------------------------------------ */
/* Where a quiet symbol went quiet                                     */
/* ------------------------------------------------------------------ */

/**
 * A symbol with no recent snapshot fails in one of two places, and the
 * page could not tell which: its candles stopped arriving, or they arrive
 * and something downstream drops them. Those need different fixes — a
 * reconnect versus a bug in the pipeline — and guessing between them cost
 * several rounds on one symbol.
 *
 * Comparing when a candle was last *received* against when a snapshot was
 * last *written* separates them, because receiving is stamped before any
 * processing.
 */
export type IngestDiagnosis =
  /** Snapshot is current. */
  | 'flowing'
  /** No candle has arrived recently — the fault is upstream of us. */
  | 'not-arriving'
  /** Candles arrive but no snapshot follows — the fault is in our pipeline. */
  | 'arriving-not-processed'
  /** No ingest timestamp for this symbol at all: an old worker build, or it never subscribed. */
  | 'unknown'
  /** The worker restarted and no candle has closed since — nothing can be concluded yet. */
  | 'warming-up';

export function diagnoseIngest(
  lastSnapshotAt: number | null,
  lastCandleAt: number | undefined,
  nowMs: number,
  staleMs: number = STALE_SNAPSHOT_MS,
): IngestDiagnosis {
  if (lastSnapshotAt !== null && nowMs - lastSnapshotAt <= staleMs) return 'flowing';
  if (lastCandleAt === undefined) return 'unknown';
  // Candles still coming in while the snapshot has gone stale: whatever is
  // wrong is downstream of the socket, which is the half we control.
  return nowMs - lastCandleAt <= staleMs ? 'arriving-not-processed' : 'not-arriving';
}

export const INGEST_TEXT: Record<IngestDiagnosis, string> = {
  flowing: '',
  'not-arriving': 'không nhận được nến — lỗi phía kết nối',
  'arriving-not-processed': 'vẫn nhận được nến nhưng không ra snapshot — lỗi ở phần xử lý',
  unknown: 'chưa rõ (worker chưa báo cáo nến của symbol này)',
  'warming-up': 'worker vừa khởi động lại — đang chờ cây nến đóng đầu tiên',
};

/* ------------------------------------------------------------------ */
/* A restarted worker is not a broken one                              */
/* ------------------------------------------------------------------ */

/**
 * How long after a boot a silent symbol still proves nothing.
 *
 * The candle callback only fires when a candle *closes*, so a worker that
 * booted a minute ago has legitimately stamped nothing and written no
 * snapshot. Reporting that as "4/4 symbol có vấn đề" turns the card red on
 * a healthy deploy, which is the failure this file's own rules warn about:
 * a card that fires on healthy data teaches the reader to ignore it.
 */
export function workerUptimeMs(services: StatusService[], nowMs: number): number | null {
  const worker = services.find((s) => s.service === 'worker');
  return worker ? nowMs - worker.startedAt : null;
}

/**
 * True while the restart alone explains the silence.
 *
 * The grace must not swallow a real outage, so it is bounded twice: the
 * worker has to be younger than one stale window, *and* the symbol's
 * silence has to be no longer than the worker's life plus that window. A
 * symbol quiet for 17 hours stays red through every restart — which is
 * exactly the case that made this card worth trusting in the first place.
 */
export function isWarmingUp(
  lastSnapshotAt: number | null,
  uptimeMs: number | null,
  nowMs: number,
  staleMs: number = STALE_SNAPSHOT_MS,
): boolean {
  // One candle window plus a minute for the snapshot to be written. Exactly
  // `staleMs` would flash the card red for the seconds between the first
  // candle closing and the row landing, on every single deploy.
  if (uptimeMs === null || uptimeMs >= staleMs + 60_000) return false;
  // Never any snapshot at all: on a worker this young that is genuinely
  // unknowable, and claiming a fault would be inventing an observation.
  if (lastSnapshotAt === null) return true;
  return nowMs - lastSnapshotAt <= staleMs + uptimeMs;
}

/** One symbol's row: its tone, the note under it, and whether it counts as a fault. */
export interface SymbolStatus {
  verdict: Verdict;
  ingest: IngestDiagnosis;
  /** Feeds the card headline. Warming up is deliberately not a problem. */
  problem: boolean;
}

export function classifySymbol(
  row: StatusCollectorSymbol,
  lastCandleAt: number | undefined,
  nowMs: number,
  uptimeMs: number | null,
): SymbolStatus {
  const ingest = diagnoseIngest(row.lastSnapshotAt, lastCandleAt, nowMs);
  if (ingest === 'flowing') return { verdict: 'ok', ingest, problem: false };
  if (isWarmingUp(row.lastSnapshotAt, uptimeMs, nowMs)) {
    return { verdict: 'idle', ingest: 'warming-up', problem: false };
  }
  return { verdict: symbolVerdict(row), ingest, problem: true };
}

/**
 * The same question as `diagnoseStuckOutcomes`, answered from a count of
 * the whole backlog instead of its eight oldest rows.
 *
 * The sample version could not be right for long: it reads oldest-first,
 * and the oldest rows are the permanently dead ones, so a handful of
 * ancient signals made every verdict say "signals predate candles" while
 * the rest of the backlog did something else entirely. This weighs the
 * causes against each other and names the one that actually dominates.
 */
export function diagnoseFromCensus(census: StatusStuckCensus, resolvableNow: number): OutcomeDiagnosis {
  if (census.pending === 0) return 'clear';

  // Rows a candle exists for are rows the resolver should be taking. If it
  // reports none resolvable while these exist, the two disagree about the
  // same window, and that is a bug rather than missing data.
  if (census.withCandles > 0) return resolvableNow > 0 ? 'draining' : 'query-fault';

  if (census.predateCandles === 0 && census.insideCoverageNoCandle === 0) return 'no-pricing-candles';

  // Whichever is larger is the one worth acting on: a backfill fixes the
  // first, only the collector fixes the second.
  return census.predateCandles >= census.insideCoverageNoCandle ? 'signals-predate-candles' : 'candle-gap';
}

/**
 * The collector card's own verdict and headline, derived from the rows it
 * already classified.
 *
 * Kept here rather than in the JSX because the counting is the part that
 * can be quietly wrong: a headline that counts a warming symbol as a fault
 * puts the card back to crying wolf after every deploy, and nothing in a
 * component would catch that.
 */
export function collectorSummary(
  statuses: SymbolStatus[],
): { verdict: Verdict; headline: string } {
  const total = statuses.length;
  if (total === 0) return { verdict: 'idle', headline: 'chưa có symbol nào' };

  const problems = statuses.filter((s) => s.problem).length;
  if (problems > 0) return { verdict: 'bad', headline: `${problems}/${total} symbol có vấn đề` };

  const warming = statuses.filter((s) => s.ingest === 'warming-up').length;
  if (warming > 0) {
    // Short on purpose: the headline sits beside the card title on a phone,
    // and the reason is already spelled out on the row and in the footnote.
    return { verdict: 'idle', headline: `${warming}/${total} chờ nến đầu tiên` };
  }
  return { verdict: 'ok', headline: `${total} symbol đều tươi` };
}

/* ------------------------------------------------------------------ */
/* Which frames may actually wake you                                  */
/* ------------------------------------------------------------------ */

/**
 * "Cảnh báo Telegram: đang bật · 1 kênh" says alerting is armed and to
 * whom. It does not say *which timeframes* may fire, so the obvious next
 * question — did setting ALERT_TIMEFRAMES take effect? — could only be
 * answered by digging through a deploy log, which is the thing this page
 * exists to avoid.
 *
 * Null when the worker or API predates the field: silence is honest there,
 * and rendering "no frames" would be an invented observation.
 */
export function describeAlertTimeframes(
  report: { armed: string[]; collected: string[]; ignored: string[] } | null | undefined,
): { tone: Verdict; value: string; note: string | null } | null {
  if (!report || report.armed.length === 0) return null;

  const value = report.armed.join(', ');

  if (report.ignored.length > 0) {
    // A name that is not collected is dropped rather than obeyed, so the
    // symptom is fewer alerts than expected — which reads as a quiet
    // market. It has to be visible.
    return {
      tone: 'warn',
      value,
      note: `Bỏ qua tên không có trong TIMEFRAMES: ${report.ignored.join(', ')}. Kiểm lại ALERT_TIMEFRAMES.`,
    };
  }

  if (report.armed.length === report.collected.length) {
    // Deliberately not phrased as "chưa đặt": setting the variable to
    // every collected frame lands here too, and claiming it is unset would
    // be a guess about which of the two happened.
    return {
      tone: 'idle',
      value,
      note: 'Mọi khung đều được bắn — ALERT_TIMEFRAMES hiện không lọc gì. Mua spot thì đặt 1h,4h trên service worker.',
    };
  }

  return { tone: 'ok', value, note: null };
}
