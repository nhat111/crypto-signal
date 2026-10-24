import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { setupAiPrompt } from './aiPrompt';
import { FLOW_META } from './coinFlow';
import { SIGNAL_TYPES, type SetupCohortComparison, type TradeSetup, type TrendState } from './types';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 23, 12);

const setup: TradeSetup = {
  id: '1',
  symbol: 'NEARUSDT',
  kind: 'pullback',
  barOpenTime: NOW - 9 * HOUR,
  detectedAt: NOW - 5 * HOUR,
  level: 4.528,
  entry: 4.925,
  stop: 4.42,
  target: 6.03,
  rr: 2.19,
  atr: 0.1,
  reasons: ['1D đang tăng và trên EMA200.', 'Giá 4H vừa chạm 4.828.', 'Kế hoạch: …'],
  status: 'open',
  resolvedAt: null,
  rMultiple: null,
  exchange: 'okx',
  cohort: 'watchlist',
  context: { scanDay: '2026-10-22', rs30d: 18.4, flow: 'spot_led' },
};

const btcDown: TrendState = {
  symbol: 'BTCUSDT',
  lastCloseTime: NOW - 12 * HOUR,
  lastClose: 81_384,
  trend: 'down',
  event: null,
  previousTrend: null,
  changedAt: null,
  ema: 70_000,
  emaPeriod: 200,
  aboveEma: true,
  swingHighs: [],
  swingLows: [],
  reasons: [],
};

const noVerdict: SetupCohortComparison = {
  watchlist: { resolved: 0, targets: 0, hitPct: null, avgR: null },
  scan: { resolved: 3, targets: 1, hitPct: null, avgR: null },
  verdict: null,
  deltaPp: null,
  marginPp: null,
};

describe('setupAiPrompt', () => {
  const text = setupAiPrompt(setup, { btcTrend: btcDown, comparison: noVerdict, minResolved: 20, nowMs: NOW, origin: 'https://x.app' });

  it('gives the plan with distances from the entry', () => {
    expect(text).toContain('Vào 4.925 · Cắt lỗ 4.42 (-10.3%) · Chốt lời 6.03 (+22.4%) · R:R 1:2.2');
  });

  it('says the NEAR setup of 23/10 came from the old detector, and a newer one does not', () => {
    expect(text).toContain('bộ dò cũ (trước 24/10)');
    const later = setupAiPrompt({ ...setup, detectedAt: Date.UTC(2026, 9, 25) }, { btcTrend: btcDown, comparison: noVerdict, minResolved: 20, nowMs: Date.UTC(2026, 9, 25, 5), origin: 'https://x.app' });
    expect(later).not.toContain('bộ dò cũ (trước 24/10)');
  });

  it('says how old the setup is and that the entry is not the live price', () => {
    expect(text).toContain('cách đây 5 giờ');
    expect(text).toContain('không phải giá hiện tại');
  });

  it("carries BTC's daily trend, which the detector never reads", () => {
    expect(text).toContain('Xu hướng 1D của BTC, hiện là: Giảm, trên EMA200.');
  });

  it('says there is no verdict yet, with the sample count', () => {
    expect(text).toContain('(0/20 setup kết thúc mỗi bên)');
  });

  it('names the flow label in words and drops the plan reason it already printed', () => {
    expect(text).toContain('"Spot mua dẫn"');
    expect(text).not.toContain('Kế hoạch:');
  });

  it('links the guide and asks for the case against', () => {
    expect(text).toContain('https://x.app/guide-for-ai.md');
    expect(text).toContain('Đừng chỉ xác nhận');
  });

  it('gives the live price when it was read, and says so when it was not', () => {
    const withPrice = setupAiPrompt(setup, { minResolved: 20, nowMs: NOW, livePrice: 5.4 });
    expect(withPrice).toContain('Giá giờ 5.4 (+9.6% so với giá vào): đã chạy xa');
    expect(text).toContain('Giá hiện tại: không đọc được lúc chép');
  });

  it("carries BTC's trend at detection and the BTC-down comparison", () => {
    const t = setupAiPrompt(
      { ...setup, btcTrend: 'down' },
      {
        minResolved: 20,
        nowMs: NOW,
        btcComparison: {
          btcDown: { resolved: 3, targets: 0, hitPct: 0, avgR: -1 },
          btcNotDown: { resolved: 25, targets: 10, hitPct: 40, avgR: 0.3 },
          verdict: null,
          deltaPp: null,
          marginPp: null,
        },
      },
    );
    expect(t).toContain('Lúc phát hiện setup, BTC 1D là: Giảm.');
    expect(t).toContain('chưa đủ mẫu (3/20 mỗi bên)');
  });

  it('says when BTC could not be read rather than leaving it out', () => {
    expect(setupAiPrompt(setup, { minResolved: 20, nowMs: NOW })).toContain('không đọc được lúc chép');
  });
});

describe('guide-for-ai.md', () => {
  const guide = readFileSync(fileURLToPath(new URL('../../public/guide-for-ai.md', import.meta.url)), 'utf8');

  // The guide is what a chat AI reads the dashboard with; a label it does
  // not know gets guessed.
  it('explains every coin flow label', () => {
    for (const meta of Object.values(FLOW_META)) expect(guide).toContain(`| ${meta.label} |`);
  });

  it('explains every signal type, as the cards print it', () => {
    for (const type of SIGNAL_TYPES) expect(guide).toContain(`| ${type.replaceAll('_', ' ')} |`);
  });
});
