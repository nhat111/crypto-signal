import { describe, expect, it } from 'vitest';
import type { OverviewRow, RecentSignalRow, TrendUpsertResult } from '@crypto-signal/db';
import { formatDigest } from './trendCycle.js';

const CLOSED_AT = Date.UTC(2026, 8, 30); // 30/09 00:00 UTC — the 29/09 bar just closed

function result(overrides: Partial<TrendUpsertResult['row']> = {}, flags: Partial<TrendUpsertResult> = {}): TrendUpsertResult {
  return {
    row: {
      symbol: 'BTCUSDT',
      lastCloseTime: CLOSED_AT - 86_400_000,
      lastClose: 83347.4,
      trend: 'up',
      event: null,
      previousTrend: null,
      changedAt: null,
      ema: 80000,
      emaPeriod: 200,
      aboveEma: true,
      swingHighs: [],
      swingLows: [],
      reasons: [],
      computedAt: CLOSED_AT,
      ...overrides,
    },
    newClose: true,
    labelChanged: false,
    newEvent: false,
    ...flags,
  };
}

const overview = [{ symbol: 'BTCUSDT', healthScore: 63.4, riskScore: 9.2 } as OverviewRow];

describe('formatDigest', () => {
  it('names the closed day, the label and where price sits against the EMA', () => {
    const text = formatDigest([result()], overview, [], CLOSED_AT);
    expect(text).toContain('ngày 29/09');
    expect(text).toContain('<b>BTCUSDT</b> 83,347 — 🟢 Tăng · trên EMA200');
    expect(text).toContain('Health 63 · Risk 9 (4h)');
    expect(text).toContain('không có');
  });

  it('flags a break only when it is new on this close', () => {
    const fresh = formatDigest([result({ trend: 'sideways', event: 'up_broken' }, { newEvent: true })], overview, [], CLOSED_AT);
    expect(fresh).toContain('Vừa gãy cấu trúc tăng');
    const carried = formatDigest([result({ trend: 'sideways', event: 'up_broken' }, { newEvent: false })], overview, [], CLOSED_AT);
    expect(carried).not.toContain('Vừa gãy');
  });

  it('lists at most three signals, most severe first, and escapes HTML', () => {
    const sig = (signalType: string, severity: string, confidence: number) =>
      ({ symbol: 'ETH<USDT', signalType, severity, confidence, timestamp: CLOSED_AT }) as unknown as RecentSignalRow;
    const text = formatDigest(
      [result()],
      overview,
      [sig('A_LOW', 'LOW', 90), sig('B_HIGH', 'HIGH', 50), sig('C_MED', 'MEDIUM', 70), sig('D_LOW', 'LOW', 10)],
      CLOSED_AT,
    );
    expect(text).toContain('Tín hiệu 4h trong 24h qua: 4');
    expect(text.indexOf('B HIGH')).toBeLessThan(text.indexOf('C MED'));
    expect(text).not.toContain('D LOW');
    expect(text).toContain('ETH&lt;USDT');
  });
});
