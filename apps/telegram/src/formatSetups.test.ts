import { describe, expect, it } from 'vitest';
import type { SetupDTO } from './apiClient.js';
import { formatSetups } from './formatting.js';

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
