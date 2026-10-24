import { describe, expect, it } from 'vitest';
import { breakoutRecordLine, pctBelow } from './breakouts';

const replay = { trades: 175, winPct: 36, avgR: 0.17, from: '2024-08-27', to: '2026-10-23', coins: 41 };
const stats = (closed: number, wins: number, avgR: number | null) => ({ closed, wins, avgR, sumR: 0, avgReturnPct: null });

describe('breakoutRecordLine', () => {
  it('withholds a verdict under the floor and compares with the replay above it', () => {
    expect(breakoutRecordLine({ stats: stats(0, 0, null), minClosed: 30, replay })).toBe('chưa có lệnh nào kết thúc');
    expect(breakoutRecordLine({ stats: stats(5, 2, -0.1), minClosed: 30, replay })).toMatch(/cần 30 lệnh/);
    expect(breakoutRecordLine({ stats: stats(30, 12, 0.2), minClosed: 30, replay })).toMatch(/chạy lại: 0\.17R/);
  });
});

describe('pctBelow', () => {
  it('is the distance from price down to the level', () => {
    expect(pctBelow(100, 90)).toBeCloseTo(10);
  });
});
