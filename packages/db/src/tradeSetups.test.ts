import { describe, expect, it } from 'vitest';
import { compareSetupBtcTrend, compareSetupCohorts, type SetupCohortGroup, type TradeSetupStats } from './tradeSetups.js';

const stats = (cohort: TradeSetupStats['cohort'], kind: TradeSetupStats['kind'], resolved: number, targets: number, avgR: number | null): TradeSetupStats => ({
  cohort,
  kind,
  total: resolved,
  open: 0,
  resolved,
  targets,
  stops: resolved - targets,
  expired: 0,
  avgR,
});

describe('compareSetupCohorts', () => {
  it('pools both kinds per cohort and leaves core out', () => {
    const c = compareSetupCohorts(
      [stats('watchlist', 'pullback', 4, 2, 0.5), stats('watchlist', 'breakout_retest', 6, 3, 1), stats('core', 'pullback', 50, 50, 2), stats('scan', 'pullback', 10, 1, -0.7)],
      20,
    );
    expect(c.watchlist).toEqual({ resolved: 10, targets: 5, hitPct: 50, avgR: 0.8 });
    expect(c.scan).toMatchObject({ resolved: 10, targets: 1, hitPct: 10 });
    expect(c.verdict).toBeNull();
  });

  it('judges once both sides clear the floor', () => {
    const better = compareSetupCohorts([stats('watchlist', 'pullback', 60, 40, 1), stats('scan', 'pullback', 200, 60, -0.1)], 20);
    expect(better.verdict).toBe('beats');
    expect(better.deltaPp).toBeCloseTo(66.67 - 30, 1);
    const same = compareSetupCohorts([stats('watchlist', 'pullback', 25, 8, 0), stats('scan', 'pullback', 200, 64, 0)], 20);
    expect(same.verdict).toBe('indistinguishable');
  });

  it('reports empty groups as unknown, not zero', () => {
    expect(compareSetupCohorts([], 20).watchlist).toEqual({ resolved: 0, targets: 0, hitPct: null, avgR: null });
  });
});

describe('compareSetupBtcTrend', () => {
  const g = (resolved: number, targets: number): SetupCohortGroup => ({ resolved, targets, hitPct: resolved ? (targets / resolved) * 100 : null, avgR: 0 });

  it('withholds a verdict until both sides clear the floor', () => {
    expect(compareSetupBtcTrend({ btcDown: g(5, 0), btcNotDown: g(100, 50) }, 20).verdict).toBeNull();
  });

  it('calls setups found while BTC was down worse when they hit the target clearly less often', () => {
    const c = compareSetupBtcTrend({ btcDown: g(80, 12), btcNotDown: g(200, 100) }, 20);
    expect(c.verdict).toBe('worse');
    expect(c.deltaPp).toBeCloseTo(15 - 50, 1);
  });
});
