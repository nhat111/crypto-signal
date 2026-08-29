import { describe, expect, it } from 'vitest';
import {
  collectorVerdict,
  isHorizonStuck,
  isJobBroken,
  isJobFailing,
  jobsVerdict,
  outcomesVerdict,
  symbolVerdict,
  versionVerdict,
} from './statusVerdicts';
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
