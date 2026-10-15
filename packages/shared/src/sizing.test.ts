import { describe, expect, it } from 'vitest';
import { formatPositionSize, positionSize } from './sizing.js';

describe('positionSize', () => {
  it('sizes a long so the stop costs exactly the risk share of the account', () => {
    const size = positionSize({ accountUsd: 1000, riskPct: 1 }, 'long', 114, 110.8);
    if (!size.ok) throw new Error('expected a size');
    expect(size.riskUsd).toBe(10);
    expect(size.units).toBeCloseTo(3.125, 6);
    expect(size.units * (114 - 110.8)).toBeCloseTo(10, 9);
    expect(size.notionalUsd).toBeCloseTo(356.25, 6);
    expect(size.leverage).toBeCloseTo(0.35625, 6);
    expect(size.spotUnits).toBeCloseTo(size.units, 9);
    expect(size.stopDistancePct).toBeCloseTo(2.807, 3);
  });

  it('sizes a short with the stop above entry', () => {
    const size = positionSize({ accountUsd: 2000, riskPct: 0.5 }, 'short', 100, 104);
    if (!size.ok) throw new Error('expected a size');
    expect(size.units).toBeCloseTo(2.5, 9);
  });

  it('refuses a stop on the wrong side or at entry rather than printing a huge size', () => {
    expect(positionSize({ accountUsd: 1000, riskPct: 1 }, 'long', 100, 101)).toEqual({ ok: false, reason: 'stop_wrong_side' });
    expect(positionSize({ accountUsd: 1000, riskPct: 1 }, 'long', 100, 100)).toEqual({ ok: false, reason: 'stop_wrong_side' });
    expect(positionSize({ accountUsd: 1000, riskPct: 1 }, 'short', 100, 99)).toEqual({ ok: false, reason: 'stop_wrong_side' });
  });

  it('refuses non-positive or non-finite inputs', () => {
    expect(positionSize({ accountUsd: 0, riskPct: 1 }, 'long', 100, 90).ok).toBe(false);
    expect(positionSize({ accountUsd: 1000, riskPct: Number.NaN }, 'long', 100, 90).ok).toBe(false);
    expect(positionSize({ accountUsd: 1000, riskPct: 1 }, 'long', 100, -1).ok).toBe(false);
  });

  it('caps the spot size at the account when a tight stop needs more than the account', () => {
    // 1% of 1,000$ over a 0.5% stop is a 2,000$ position.
    const size = positionSize({ accountUsd: 1000, riskPct: 1 }, 'long', 100, 99.5);
    if (!size.ok) throw new Error('expected a size');
    expect(size.leverage).toBeCloseTo(2, 9);
    expect(size.spotUnits).toBeCloseTo(10, 9);
    expect(size.spotRiskUsd).toBeCloseTo(5, 9);
  });
});

describe('formatPositionSize', () => {
  it('prints units, notional and the loss at the stop', () => {
    const profile = { accountUsd: 1000, riskPct: 1 };
    const lines = formatPositionSize(positionSize(profile, 'long', 114, 110.8), profile, 'SOL');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Cỡ lệnh \(TK 1,000\$, rủi ro 1%\): 3\.1[23] SOL ≈ 356\$ · mất 10\$ nếu dính cắt lỗ$/);
  });

  it('uses significant digits for sub-unit sizes', () => {
    const profile = { accountUsd: 500, riskPct: 1 };
    const lines = formatPositionSize(positionSize(profile, 'long', 80000, 78000), profile, 'BTC');
    expect(lines[0]).toContain('0.00250 BTC ≈ 200$ · mất 5$');
  });

  it('adds the spot cap, never just a leverage figure, when the size exceeds the account', () => {
    const profile = { accountUsd: 1000, riskPct: 1 };
    const lines = formatPositionSize(positionSize(profile, 'long', 100, 99.5), profile, 'X');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('cần x2.0');
    expect(lines[1]).toContain('spot tối đa 10.00 X');
    expect(lines[1]).toContain('chỉ mất 5$');
  });

  it('says when it cannot size instead of printing a number', () => {
    const profile = { accountUsd: 1000, riskPct: 1 };
    expect(formatPositionSize(positionSize(profile, 'long', 100, 101), profile, 'X')[0]).toContain('sai phía');
  });
});

describe('formatPositionSize example label', () => {
  it('marks a size computed on a stand-in account', () => {
    const profile = { accountUsd: 1000, riskPct: 1 };
    expect(formatPositionSize(positionSize(profile, 'long', 114, 110.8), profile, 'SOL', { example: true })[0]).toMatch(/^Cỡ lệnh ví dụ \(TK 1,000\$/);
  });
});
