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

describe('formatSetupAlert', () => {
  it('gives the three numbers, R:R and the guide’s example size, and keeps the plan line out of the bullets', async () => {
    const { formatSetupAlert } = await import('./trendCycle.js');
    const text = formatSetupAlert({
      id: '1',
      symbol: 'SOLUSDT',
      kind: 'pullback',
      barOpenTime: 0,
      detectedAt: 0,
      level: 112.5,
      entry: 114,
      stop: 110.8,
      target: 124.95,
      rr: 3.4,
      atr: 2,
      reasons: ['1D đang tăng.', 'Nến 4H chạm đáy rồi bật lên.', 'Kế hoạch: …'],
      status: 'open',
      resolvedAt: null,
      rMultiple: null,
    });
    expect(text).toContain('SOLUSDT 4H — Hồi về hỗ trợ');
    expect(text).toContain('Vào ~114 · Cắt lỗ 110.8 · Chốt lời 124.95');
    expect(text).toContain('R:R 1:3.4');
    expect(text).toMatch(/3\.1[23] SOL/);
    expect(text).not.toContain('Kế hoạch:');
  });
});
