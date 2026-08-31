import { describe, expect, it } from 'vitest';
import {
  DIAGNOSIS_TEXT,
  collectorVerdict,
  diagnoseStuckOutcomes,
  isHorizonStuck,
  isJobBroken,
  isJobFailing,
  jobsVerdict,
  outcomesVerdict,
  symbolVerdict,
  versionVerdict,
} from './statusVerdicts';
import type { OutcomeDiagnosis } from './statusVerdicts';
import type { StatusCollectorSymbol, StatusJob, StatusOutcomeHorizon, StatusVersion } from './types';

const version = (commit: string | null): StatusVersion => ({
  commit,
  commitSource: commit ? 'GIT_COMMIT' : null,
  startedAt: 0,
  uptimeMs: 0,
  schema: { latest: '010_job_health.sql', appliedAt: 0 },
});

const sym = (ageMinutes: number | null): StatusCollectorSymbol => ({
  symbol: 'BTCUSDT',
  lastSnapshotAt: ageMinutes === null ? null : 1,
  ageMs: ageMinutes === null ? null : ageMinutes * 60_000,
});

const horizon = (pending: number, resolvableNow: number): StatusOutcomeHorizon => ({
  horizon: '1h',
  resolved: 10,
  pending,
  resolvableNow,
  oldestPendingAt: pending > 0 ? 1 : null,
});

const job = (over: Partial<StatusJob> = {}): StatusJob => ({
  jobName: 'stablecoin_flow',
  lastAttemptAt: 1,
  lastSuccessAt: 1,
  consecutiveFailures: 0,
  lastError: null,
  ...over,
});

describe('versionVerdict', () => {
  it('is neutral, not red, when no commit variable is set', () => {
    // Not knowing the version says nothing about whether the service works.
    expect(versionVerdict(version(null))).toBe('idle');
  });

  it('is ok once a commit is known', () => {
    expect(versionVerdict(version('abc1234'))).toBe('ok');
  });
});

describe('collector freshness', () => {
  it('flags a symbol that has never produced a snapshot', () => {
    expect(symbolVerdict(sym(null))).toBe('bad');
  });

  it('flags a snapshot older than the staleness window', () => {
    expect(symbolVerdict(sym(20))).toBe('bad');
  });

  it('accepts a recent snapshot', () => {
    expect(symbolVerdict(sym(3))).toBe('ok');
  });

  it('turns the whole card red if any one symbol is stale', () => {
    expect(collectorVerdict([sym(1), sym(1), sym(99)])).toBe('bad');
  });

  it('is neutral before any symbol is registered', () => {
    expect(collectorVerdict([])).toBe('idle');
  });
});

describe('outcome tracker', () => {
  it('does not cry wolf over a backlog that is being worked through', () => {
    expect(isHorizonStuck(horizon(500, 200))).toBe(false);
    expect(outcomesVerdict([horizon(500, 200)])).toBe('ok');
  });

  it('flags a backlog where nothing can be priced — the failure that used to go unnoticed', () => {
    expect(isHorizonStuck(horizon(500, 0))).toBe(true);
    expect(outcomesVerdict([horizon(1, 1), horizon(500, 0)])).toBe('warn');
  });

  it('treats nothing-pending as idle rather than healthy', () => {
    expect(isHorizonStuck(horizon(0, 0))).toBe(false);
    expect(outcomesVerdict([horizon(0, 0)])).toBe('idle');
  });
});

describe('background jobs', () => {
  it('calls a job that has never succeeded broken, however few attempts', () => {
    expect(isJobBroken(job({ lastSuccessAt: null, consecutiveFailures: 1 }))).toBe(true);
    expect(jobsVerdict([job({ lastSuccessAt: null, consecutiveFailures: 1 })])).toBe('bad');
  });

  it('stays quiet about one or two failures after a good run', () => {
    const j = job({ consecutiveFailures: 2 });
    expect(isJobFailing(j)).toBe(false);
    expect(jobsVerdict([j])).toBe('ok');
  });

  it('warns once failures become a streak', () => {
    const j = job({ consecutiveFailures: 3 });
    expect(isJobFailing(j)).toBe(true);
    expect(jobsVerdict([j])).toBe('warn');
  });

  it('ranks a never-succeeded job above a merely-failing one', () => {
    // Both present: the worse verdict must win, or the broken one hides.
    const verdict = jobsVerdict([job({ consecutiveFailures: 5 }), job({ lastSuccessAt: null, consecutiveFailures: 1 })]);
    expect(verdict).toBe('bad');
  });

  it('is neutral before any job has recorded a run', () => {
    expect(jobsVerdict([])).toBe('idle');
  });
});

describe('diagnoseStuckOutcomes', () => {
  const coverage = (symbol: string, candles: number, earliestAt: number | null, latestAt: number | null) => ({
    symbol,
    candles,
    earliestAt,
    latestAt,
  });
  const stuck = (symbol: string, timestamp: number, candlesInWindow: number) => ({
    symbol,
    timeframe: '15m',
    signalType: 'CVD_DIVERGENCE',
    source: 'backfill',
    timestamp,
    candlesInWindow,
  });

  const T0 = 1_800_000_000_000;
  const DAY = 86_400_000;

  it('says nothing is wrong when nothing is waiting', () => {
    expect(diagnoseStuckOutcomes([coverage('BTCUSDT', 9000, T0, T0 + DAY)], [], 0)).toBe('clear');
  });

  it('catches an empty candle store before blaming anything else', () => {
    // The whole system cannot score a single signal in this state, and it
    // is the one cause an operator can fix from an env var.
    expect(diagnoseStuckOutcomes([coverage('BTCUSDT', 0, null, null)], [stuck('BTCUSDT', T0, 0)], 0)).toBe(
      'no-pricing-candles',
    );
    expect(diagnoseStuckOutcomes([], [stuck('BTCUSDT', T0, 0)], 0)).toBe('no-pricing-candles');
  });

  it('separates signals older than the candles from a hole in the candles', () => {
    const held = [coverage('BTCUSDT', 9000, T0, T0 + 30 * DAY)];

    // Replayed 30 days back while candles only start at T0.
    expect(diagnoseStuckOutcomes(held, [stuck('BTCUSDT', T0 - 5 * DAY, 0)], 0)).toBe('signals-predate-candles');

    // Sitting inside the stored range with an empty window: a real gap.
    expect(diagnoseStuckOutcomes(held, [stuck('BTCUSDT', T0 + 10 * DAY, 0)], 0)).toBe('candle-gap');
  });

  it('treats one in-range row among older ones as a gap, not as predating', () => {
    // "All of them predate" is the only clean explanation; a single row
    // inside the range disproves it, and must not be averaged away.
    const held = [coverage('BTCUSDT', 9000, T0, T0 + 30 * DAY)];
    const rows = [stuck('BTCUSDT', T0 - DAY, 0), stuck('BTCUSDT', T0 + 2 * DAY, 0)];
    expect(diagnoseStuckOutcomes(held, rows, 0)).toBe('candle-gap');
  });

  it('counts a symbol missing from coverage as predating, not as a gap', () => {
    // No candles at all for that symbol: same fix as predating, and
    // calling it a gap would send the operator hunting a lost connection.
    const held = [coverage('BTCUSDT', 9000, T0, T0 + DAY)];
    expect(diagnoseStuckOutcomes(held, [stuck('HYPEUSDT', T0 + 2 * DAY, 0)], 0)).toBe('signals-predate-candles');
  });

  it('distinguishes a draining queue from a resolver that contradicts itself', () => {
    const held = [coverage('BTCUSDT', 9000, T0, T0 + 30 * DAY)];
    const withCandles = [stuck('BTCUSDT', T0 + DAY, 6)];

    // Candles present and the resolver agrees it can take rows: just work.
    expect(diagnoseStuckOutcomes(held, withCandles, 12)).toBe('draining');

    // Candles present but the resolver says zero — the two read the same
    // window, so this is a bug rather than missing data.
    expect(diagnoseStuckOutcomes(held, withCandles, 0)).toBe('query-fault');
  });

  it('does not call a queue healthy because one row among dead ones is workable', () => {
    // The state this was written against: five pending, four of them 30
    // days older than any candle, one live row the tracker can take. It
    // read as "đang chấm dần" — the queue drains to four and stops there,
    // and the page says everything is fine.
    const held = [coverage('BTCUSDT', 41, T0, T0 + 3 * DAY)];
    const rows = [
      stuck('BTCUSDT', T0 - 30 * DAY, 0),
      stuck('BTCUSDT', T0 - 29 * DAY, 0),
      stuck('BTCUSDT', T0 + DAY, 1),
    ];
    expect(diagnoseStuckOutcomes(held, rows, 1)).toBe('signals-predate-candles');
  });

  it('has wording for every diagnosis', () => {
    // A diagnosis with no text renders as a blank card — worse than none.
    const all: OutcomeDiagnosis[] = [
      'clear',
      'no-pricing-candles',
      'signals-predate-candles',
      'candle-gap',
      'draining',
      'query-fault',
    ];
    for (const key of all) {
      expect(DIAGNOSIS_TEXT[key].headline.length).toBeGreaterThan(0);
      expect(DIAGNOSIS_TEXT[key].detail.length).toBeGreaterThan(20);
    }
  });
});
