import { describe, expect, it } from 'vitest';
import { sumDailyOpenInterest, type OiDay } from './oiAggregate.js';

const DAY = 86_400_000;
const D0 = Date.UTC(2026, 9, 5);
const days = (values: number[], start = D0): OiDay[] => values.map((coins, i) => ({ time: start + i * DAY, coins }));

describe('sumDailyOpenInterest', () => {
  it('adds every venue day by day', () => {
    const out = sumDailyOpenInterest({ venue: 'okx', days: days([10, 20, 30]) }, [{ venue: 'gate', days: days([1, 2, 3]) }], 3);
    expect(out).toEqual({ coins: [11, 22, 33], venues: ['okx', 'gate'] });
  });

  it('matches days by time, not by position', () => {
    const shuffled = days([1, 2, 3]).reverse();
    const out = sumDailyOpenInterest({ venue: 'okx', days: days([10, 20, 30]) }, [{ venue: 'gate', days: shuffled }], 3);
    expect(out.coins).toEqual([11, 22, 33]);
  });

  it('keeps only the last `points` days', () => {
    const out = sumDailyOpenInterest({ venue: 'okx', days: days([1, 2, 3, 4]) }, [], 2);
    expect(out).toEqual({ coins: [3, 4], venues: ['okx'] });
  });

  it('drops a venue that started reporting inside the window instead of reading it as new positions', () => {
    const late = days([5, 5], D0 + 2 * DAY);
    const out = sumDailyOpenInterest({ venue: 'okx', days: days([10, 10, 10, 10]) }, [{ venue: 'bybit', days: late }], 4);
    expect(out).toEqual({ coins: [10, 10, 10, 10], venues: ['okx'] });
  });

  it('shifts the window back a day rather than drop a venue that lacks only the forming day', () => {
    const primary = days([10, 10, 10, 10, 12]);
    const out = sumDailyOpenInterest({ venue: 'okx', days: primary }, [{ venue: 'bybit', days: days([5, 5, 5, 6]) }], 4);
    expect(out).toEqual({ coins: [15, 15, 15, 16], venues: ['okx', 'bybit'] });
  });

  it('drops the venue that overlaps least, keeping the others', () => {
    const out = sumDailyOpenInterest(
      { venue: 'okx', days: days([10, 10, 10]) },
      [
        { venue: 'gate', days: days([1, 1, 1]) },
        { venue: 'bybit', days: days([5], D0 + 2 * DAY) },
      ],
      3,
    );
    expect(out).toEqual({ coins: [11, 11, 11], venues: ['okx', 'gate'] });
  });

  it('ignores zero, negative and non-finite readings', () => {
    const bad = [{ time: D0, coins: 0 }, { time: D0 + DAY, coins: Number.NaN }, ...days([1], D0 + 2 * DAY)];
    const out = sumDailyOpenInterest({ venue: 'okx', days: days([10, 10, 10]) }, [{ venue: 'gate', days: bad }], 3);
    expect(out).toEqual({ coins: [10, 10, 10], venues: ['okx'] });
  });

  it('returns the primary alone when even it cannot fill the window; the reader then says it is too short', () => {
    expect(sumDailyOpenInterest({ venue: 'okx', days: days([1, 2]) }, [{ venue: 'gate', days: days([1, 2]) }], 8)).toEqual({
      coins: [1, 2],
      venues: ['okx'],
    });
    expect(sumDailyOpenInterest({ venue: 'okx', days: [] }, [{ venue: 'gate', days: days([1]) }], 8)).toEqual({ coins: [], venues: ['okx'] });
  });
});
