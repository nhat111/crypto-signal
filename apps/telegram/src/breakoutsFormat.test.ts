import { describe, expect, it } from 'vitest';
import type { SpotBreakoutsDTO } from './apiClient.js';
import { formatBreakouts } from './breakoutsFormat.js';

const base: SpotBreakoutsDTO = {
  enabled: true,
  run: { day: '2026-10-23', regimeUp: true, btcClose: 1, btcEma50: 1, btcEma200: 1 },
  open: [],
  closed: [],
  stats: { closed: 0, wins: 0, avgR: null },
  minClosed: 30,
  replay: { trades: 175, winPct: 36, avgR: 0.17 },
};

describe('formatBreakouts', () => {
  it('says standing aside is the rule while BTC is not up', () => {
    const text = formatBreakouts({ ...base, run: { ...base.run!, regimeUp: false } }, null);
    expect(text).toContain('Xu hướng dài của BTC chưa tăng');
    expect(text).toContain('chưa phải tín hiệu mua');
  });

  it('sizes an open position for the chat account', () => {
    const text = formatBreakouts(
      { ...base, open: [{ symbol: 'NEARUSDT', barOpenTime: Date.UTC(2026, 9, 23), entry: 5, stop: 4.5, trail: 4.5, status: 'open', exitTime: null, returnPct: null, rMultiple: null }] },
      { accountUsd: 51, riskPct: 1 },
    );
    expect(text).toContain('NEARUSDT');
    expect(text).toContain('(−10.0%)');
    expect(text).toMatch(/Cỡ lệnh \(TK .*51.*rủi ro 1%\)/);
  });

  it('keeps cheap coins readable', () => {
    const text = formatBreakouts(
      { ...base, open: [{ symbol: 'GALAUSDT', barOpenTime: Date.UTC(2026, 9, 23), entry: 0.012345, stop: 0.01111, trail: 0.01111, status: 'open', exitTime: null, returnPct: null, rMultiple: null }] },
      null,
    );
    expect(text).toContain('Vào 0.012345 · cắt lỗ 0.01111');
  });

  it('withholds the record verdict under the floor', () => {
    expect(formatBreakouts({ ...base, stats: { closed: 3, wins: 1, avgR: -0.2 } }, null)).toContain('cần 30 lệnh');
  });
});
