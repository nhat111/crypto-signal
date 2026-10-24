import { describe, expect, it } from 'vitest';
import type { SetupDTO } from './apiClient.js';
import { formatRiskProfile, formatSetups, riskProfileOf } from './formatting.js';

const setup = (overrides: Partial<SetupDTO> = {}): SetupDTO => ({
  symbol: 'SOLUSDT', kind: 'pullback', detectedAt: 0, entry: 114, stop: 110.8, target: 124.95, rr: 3.4, status: 'open', rMultiple: null, ...overrides,
});

describe('formatSetups', () => {
  it('marks an open setup found on OKX bars, and leaves Binance ones and older payloads plain', () => {
    expect(formatSetups([setup({ exchange: 'okx' })])).toContain('Hồi về hỗ trợ <i>(nến OKX)</i>');
    expect(formatSetups([setup({ exchange: 'binance' })])).not.toContain('OKX');
    expect(formatSetups([setup()])).not.toContain('OKX');
  });
});

describe('formatSetups old detector', () => {
  it('labels setups stored before the tightened detector ran, and only those', () => {
    expect(formatSetups([setup({ detectedAt: Date.UTC(2026, 9, 23) })])).toContain('bộ dò cũ (trước 24/10)');
    expect(formatSetups([setup({ detectedAt: Date.UTC(2026, 9, 25) })])).not.toContain('bộ dò cũ (trước 24/10)');
  });
});

describe('formatSetups sizing', () => {
  it('sizes each open setup for the chat\'s account', () => {
    const text = formatSetups([setup(), setup({ status: 'stop', rMultiple: -1 })], { accountUsd: 2000, riskPct: 1 });
    expect(text).toContain('Cỡ lệnh (TK 2,000$, rủi ro 1%)');
    expect(text.match(/Cỡ lệnh/g)).toHaveLength(1);
    expect(text).not.toContain('/risk');
  });

  it('points to /risk instead of sizing when no account is set, and only when something is open', () => {
    expect(formatSetups([setup()])).toContain('/risk VỐN');
    expect(formatSetups([setup()])).not.toContain('Cỡ lệnh');
    expect(formatSetups([])).not.toContain('/risk');
  });
});

describe('riskProfileOf / formatRiskProfile', () => {
  const base = { chatId: '1', alertsEnabled: true, minSeverity: 'MEDIUM', symbols: [] };

  it('has no profile without an account, including from an API that predates it', () => {
    expect(riskProfileOf(undefined)).toBeNull();
    expect(riskProfileOf(base)).toBeNull();
    expect(riskProfileOf({ ...base, accountUsd: null, riskPct: 1 })).toBeNull();
  });

  it('reads account and risk', () => {
    expect(riskProfileOf({ ...base, accountUsd: 1500, riskPct: 0.5 })).toEqual({ accountUsd: 1500, riskPct: 0.5 });
  });

  it('says the money at risk per trade', () => {
    expect(formatRiskProfile({ accountUsd: 1500, riskPct: 0.5 })).toContain('0.5% = 7.5$');
    expect(formatRiskProfile(null)).toContain('Chưa đặt vốn');
  });
});
