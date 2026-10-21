import { describe, expect, it } from 'vitest';
import { farmProjectKey, summarizeFarmActivity } from './airdrop.js';

const DAY = 86_400_000;
// Monday 2026-10-05, 00:00 UTC.
const MON = Date.UTC(2026, 9, 5);

describe('farmProjectKey', () => {
  it('folds case and spacing so the bot and the web land on one farm', () => {
    expect(farmProjectKey('  Polymarket   International ')).toBe('polymarket international');
    expect(farmProjectKey('Symbiotic')).toBe(farmProjectKey('symbiotic'));
  });
});

describe('summarizeFarmActivity', () => {
  it('reports nothing for no actions, not zero days since', () => {
    expect(summarizeFarmActivity([], MON)).toMatchObject({ actionCount: 0, totalCostUsd: 0, daysSinceLast: null });
  });

  it('counts Monday-based weeks and calendar months, and sums the cost', () => {
    const actions = [
      { atMs: MON + 1 * DAY, costUsd: 1.5 }, // Tue, week 1
      { atMs: MON + 6 * DAY, costUsd: 0.5 }, // Sun, still week 1
      { atMs: MON + 7 * DAY, costUsd: 2 }, // next Monday, week 2
      { atMs: Date.UTC(2026, 10, 2), costUsd: 1 }, // November
    ];
    const s = summarizeFarmActivity(actions, Date.UTC(2026, 10, 12));
    expect(s.actionCount).toBe(4);
    expect(s.totalCostUsd).toBe(5);
    expect(s.activeWeeks).toBe(3);
    expect(s.activeMonths).toBe(2);
    expect(s.firstActionAt).toBe(MON + DAY);
    expect(s.daysSinceLast).toBe(10);
  });
});
