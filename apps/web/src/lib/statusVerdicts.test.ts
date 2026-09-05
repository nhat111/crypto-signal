import { describe, expect, it } from 'vitest';
import {
  DIAGNOSIS_TEXT,
  INGEST_TEXT,
  classifySymbol,
  collectorSummary,
  connectionVerdict,
  diagnoseFromCensus,
  diagnoseIngest,
  isHorizonStuck,
  isJobBroken,
  isJobFailing,
  jobsVerdict,
  outcomesVerdict,
  symbolVerdict,
  isWarmingUp,
  versionVerdict,
  workerUptimeMs,
  workerVerdict,
} from './statusVerdicts';
import type { OutcomeDiagnosis } from './statusVerdicts';
import type { StatusStuckCensus } from './types';
import type { StatusCollectorSymbol, StatusJob, StatusOutcomeHorizon, StatusService, StatusVersion } from './types';

const version = (commit: string | null): StatusVersion => ({
  commit,
  commitSource: commit ? 'GIT_COMMIT' : null,
  startedAt: 0,
  uptimeMs: 0,
  schema: { latest: '010_job_health.sql', appliedAt: 0 },
});

const NOW = 1_800_000_000_000;

const sym = (ageMinutes: number | null): StatusCollectorSymbol => ({
  symbol: 'BTCUSDT',
  // Anchored to NOW rather than a token value: classifySymbol reads the
  // timestamp, not just the pre-computed age.
  lastSnapshotAt: ageMinutes === null ? null : NOW - ageMinutes * 60_000,
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
    expect(collectorSummary([sym(1), sym(1), sym(99)].map((r) => classifySymbol(r, undefined, NOW, null))).verdict).toBe('bad');
  });

  it('is neutral before any symbol is registered', () => {
    expect(collectorSummary([]).verdict).toBe('idle');
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

describe('workerVerdict', () => {
  const worker = (ageMs: number, connections: Record<string, string>) => ({
    service: 'worker',
    lastHeartbeatAt: 1_800_000_000_000 - ageMs,
    ageMs,
    connections: { spot: 'open', futures: 'open', liquidation: 'open', ...connections },
  });

  it('is neutral before the first heartbeat', () => {
    // A cold start is not a fault, and colouring it red teaches the reader
    // to ignore the colour.
    expect(workerVerdict(null)).toBe('idle');
  });

  it('is green when every socket is open and the beat is fresh', () => {
    expect(workerVerdict(worker(30_000, {}))).toBe('ok');
  });

  it('flags a socket that is not open', () => {
    expect(workerVerdict(worker(30_000, { futures: 'closed' }))).toBe('warn');
    expect(workerVerdict(worker(30_000, { liquidation: 'connecting' }))).toBe('warn');
  });

  it('goes red on a stale heartbeat even when the row says every socket is open', () => {
    // The trap this exists for: the process died with "open" written in the
    // row, so the row keeps claiming health forever.
    expect(workerVerdict(worker(10 * 60_000, {}))).toBe('bad');
  });

  it('tolerates a couple of missed beats', () => {
    expect(workerVerdict(worker(2 * 60_000 + 1, {}))).toBe('ok');
  });
});

describe('connectionVerdict', () => {
  it('reads a stale row as unknown, never as a state', () => {
    // Reporting "closed" from a row nobody updated in an hour would be
    // inventing an observation.
    expect(connectionVerdict('open', true)).toBe('idle');
    expect(connectionVerdict('closed', true)).toBe('idle');
  });

  it('maps live states', () => {
    expect(connectionVerdict('open', false)).toBe('ok');
    expect(connectionVerdict('connecting', false)).toBe('warn');
    expect(connectionVerdict('closed', false)).toBe('bad');
    expect(connectionVerdict('error', false)).toBe('bad');
  });
});

describe('diagnoseIngest', () => {
  const now = 1_800_000_000_000;
  const MIN = 60_000;

  it('says nothing when the snapshot is current', () => {
    expect(diagnoseIngest(now - 2 * MIN, now - MIN, now)).toBe('flowing');
  });

  it('separates a dead socket from a broken pipeline', () => {
    // The distinction this exists for. Same symptom on the collector card,
    // completely different fix.
    expect(diagnoseIngest(now - 60 * MIN, now - MIN, now)).toBe('arriving-not-processed');
    expect(diagnoseIngest(now - 60 * MIN, now - 60 * MIN, now)).toBe('not-arriving');
  });

  it('is unknown rather than a guess when the worker reported no ingest time', () => {
    // An older worker build publishes no ingest map at all. Reading that
    // absence as "not arriving" would blame the network for a deploy.
    expect(diagnoseIngest(now - 60 * MIN, undefined, now)).toBe('unknown');
  });

  it('treats a symbol that never produced a snapshot as diagnosable', () => {
    expect(diagnoseIngest(null, now - MIN, now)).toBe('arriving-not-processed');
    expect(diagnoseIngest(null, now - 60 * MIN, now)).toBe('not-arriving');
  });

  it('has wording for every diagnosis except the healthy one', () => {
    expect(INGEST_TEXT.flowing).toBe('');
    for (const key of ['not-arriving', 'arriving-not-processed', 'unknown'] as const) {
      expect(INGEST_TEXT[key].length).toBeGreaterThan(10);
    }
  });
});

describe('diagnoseFromCensus', () => {
  const census = (over: Partial<StatusStuckCensus>): StatusStuckCensus => ({
    horizon: '15m',
    pending: 0,
    withCandles: 0,
    predateCandles: 0,
    insideCoverageNoCandle: 0,
    ...over,
  });

  it('is clear when nothing is pending', () => {
    expect(diagnoseFromCensus(census({}), 0)).toBe('clear');
  });

  it('is not dominated by a small ancient tail', () => {
    // The exact failure the sample version had: eight ancient rows made the
    // verdict say "predate" while ninety-nine percent of the backlog sat in
    // a candle gap. Counting decides it the other way, correctly.
    const c = census({ pending: 107, predateCandles: 7, insideCoverageNoCandle: 100 });
    expect(diagnoseFromCensus(c, 0)).toBe('candle-gap');
  });

  it('still names predating when that is what dominates', () => {
    const c = census({ pending: 107, predateCandles: 100, insideCoverageNoCandle: 7 });
    expect(diagnoseFromCensus(c, 0)).toBe('signals-predate-candles');
  });

  it('calls a resolver that contradicts itself a bug, not missing data', () => {
    const c = census({ pending: 50, withCandles: 50 });
    expect(diagnoseFromCensus(c, 0)).toBe('query-fault');
    expect(diagnoseFromCensus(c, 12)).toBe('draining');
  });

  it('reports an empty candle store as such', () => {
    // Nothing has a candle and nothing is inside coverage either, because
    // there is no coverage.
    const c = census({ pending: 40, predateCandles: 0, insideCoverageNoCandle: 0 });
    expect(diagnoseFromCensus(c, 0)).toBe('no-pricing-candles');
  });
})


describe('a restarted worker is not a broken one', () => {
  const now = 1_800_000_000_000;
  const MIN = 60_000;

  /** A symbol whose last snapshot is `silentMinutes` old. */
  const quiet = (symbol: string, silentMinutes: number): StatusCollectorSymbol => ({
    symbol,
    lastSnapshotAt: now - silentMinutes * MIN,
    ageMs: silentMinutes * MIN,
  });

  const service = (name: string, startedMinutesAgo: number): StatusService => ({
    service: name,
    commit: 'abc1234',
    commitSource: 'RAILWAY_GIT_COMMIT_SHA',
    startedAt: now - startedMinutesAgo * MIN,
  });

  it('reads the uptime off the worker row, not whichever service came first', () => {
    // The api restarts on its own schedule. Taking its clock would grant the
    // grace period at the wrong moments and withhold it at the right ones.
    expect(workerUptimeMs([service('api', 300), service('worker', 5)], now)).toBe(5 * MIN);
    expect(workerUptimeMs([service('api', 300)], now)).toBeNull();
    expect(workerUptimeMs([], now)).toBeNull();
  });

  it('does not call a symbol broken when no candle could have closed yet', () => {
    // The real screenshot: worker up 5 minutes, last snapshot 17 minutes
    // old, ingest map empty because the callback only fires on a close.
    const status = classifySymbol(quiet('BTCUSDT', 17), undefined, now, 5 * MIN);
    expect(status.problem).toBe(false);
    expect(status.ingest).toBe('warming-up');
    expect(status.verdict).toBe('idle');
  });

  it('keeps a long-dead symbol red through a restart', () => {
    // The case the grace period must never swallow — HYPEUSDT had been
    // silent 17 hours across several deploys. If a restart cleared it, the
    // card would go green exactly when someone looks after deploying.
    const status = classifySymbol(quiet('HYPEUSDT', 17 * 60), undefined, now, 5 * MIN);
    expect(status.problem).toBe(true);
    expect(status.ingest).toBe('unknown');
    expect(status.verdict).toBe('bad');
  });

  it('stops granting the grace once the worker has had a full window', () => {
    // 40 minutes up and still nothing: the restart no longer explains it.
    const status = classifySymbol(quiet('BTCUSDT', 17), undefined, now, 40 * MIN);
    expect(status.problem).toBe(true);
    expect(status.ingest).toBe('unknown');
  });

  it('grants nothing when the worker has never reported its build', () => {
    // No worker row means no uptime to reason from, and an unknown must not
    // be read as an excuse.
    expect(classifySymbol(quiet('BTCUSDT', 17), undefined, now, null).problem).toBe(true);
  });

  it('leaves a healthy symbol alone whatever the uptime', () => {
    const fresh = quiet('BTCUSDT', 2);
    for (const uptime of [1 * MIN, 5 * MIN, 600 * MIN, null]) {
      const status = classifySymbol(fresh, now - MIN, now, uptime);
      expect(status.ingest).toBe('flowing');
      expect(status.problem).toBe(false);
      expect(status.verdict).toBe('ok');
    }
  });

  it('still names the broken half when the fault is real during a young boot', () => {
    // Candles arriving but nothing produced, on a worker up 5 minutes but
    // silent far longer than that: the pipeline diagnosis must survive.
    const status = classifySymbol(quiet('SOLUSDT', 300), now - MIN, now, 5 * MIN);
    expect(status.problem).toBe(true);
    expect(status.ingest).toBe('arriving-not-processed');
  });

  it('bounds the grace at both ends', () => {
    // Young worker + silence within one window of its life → warming.
    expect(isWarmingUp(now - 19 * MIN, 5 * MIN, now)).toBe(true);
    // Exactly on the bound is still explained by the restart.
    expect(isWarmingUp(now - 20 * MIN, 5 * MIN, now)).toBe(true);
    // Same worker, silence one minute past that bound → not warming.
    expect(isWarmingUp(now - 21 * MIN, 5 * MIN, now)).toBe(false);
    // Worker past one window plus the write margin → no grace at all,
    // however long the symbol has been quiet.
    expect(isWarmingUp(now - 16 * MIN, 16 * MIN, now)).toBe(false);
    expect(isWarmingUp(now - 20 * MIN, 60 * MIN, now)).toBe(false);
    // A minute under that bound it still holds — the margin is deliberate.
    expect(isWarmingUp(now - 16 * MIN, 15 * MIN, now)).toBe(true);
  });

  it('admits it cannot tell when a young worker has never produced a snapshot', () => {
    expect(isWarmingUp(null, 2 * MIN, now)).toBe(true);
    expect(isWarmingUp(null, 60 * MIN, now)).toBe(false);
  });

  it('counts only real faults in the headline', () => {
    // Three symbols on a worker up 5 minutes: one dead for 17 hours, two
    // merely waiting for their first close. The card must name one problem,
    // not three — the screenshot that started this said "4/4 symbol có vấn đề"
    // on a healthy deploy.
    const statuses = [
      classifySymbol(quiet('BTCUSDT', 17), undefined, now, 5 * MIN),
      classifySymbol(quiet('ETHUSDT', 17), undefined, now, 5 * MIN),
      classifySymbol(quiet('HYPEUSDT', 17 * 60), undefined, now, 5 * MIN),
    ];
    const summary = collectorSummary(statuses);
    expect(summary.verdict).toBe('bad');
    expect(summary.headline).toContain('1/3');

    const allWarming = statuses.slice(0, 2);
    expect(collectorSummary(allWarming).verdict).toBe('idle');
    expect(collectorSummary(allWarming).headline).toContain('2/2');

    const allFresh = [quiet('BTCUSDT', 1), quiet('ETHUSDT', 1)].map((r) =>
      classifySymbol(r, now - MIN, now, 5 * MIN),
    );
    expect(collectorSummary(allFresh).verdict).toBe('ok');
    expect(collectorSummary(allFresh).headline).toContain('đều tươi');
  });

  it('is not fooled by an ingest time carried over from the previous process', () => {
    // The worker now seeds its last-candle-seen map from the database at
    // boot, so the evidence survives a deploy. That means a card can see a
    // recent ingest stamp written by the *old* process while the new one
    // has produced nothing yet — which would read as "candles arrive but
    // nothing comes out", i.e. our bug, on a deploy that is merely young.
    const status = classifySymbol(quiet('BTCUSDT', 17), now - 2 * MIN, now, 5 * MIN);
    expect(status.ingest).toBe('warming-up');
    expect(status.problem).toBe(false);
  });

  it('still blames the pipeline once the worker has had its window', () => {
    // Same seeded stamp, older worker: now the reading is real and must
    // not be excused.
    const status = classifySymbol(quiet('BTCUSDT', 60), now - 2 * MIN, now, 90 * MIN);
    expect(status.ingest).toBe('arriving-not-processed');
    expect(status.problem).toBe(true);
  });

  it('has wording for the warming state', () => {
    expect(INGEST_TEXT['warming-up'].length).toBeGreaterThan(10);
  });
});
