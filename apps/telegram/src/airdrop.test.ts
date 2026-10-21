import { describe, expect, it } from 'vitest';
import { formatAirdrops, formatFarms, parseFarmArgs, type AirdropCandidateDTO, type FarmDTO } from './airdrop.js';

describe('parseFarmArgs', () => {
  it('lists with no arguments', () => {
    expect(parseFarmArgs('/farm')).toEqual({ kind: 'list' });
    expect(parseFarmArgs('/farm@my_bot  ')).toEqual({ kind: 'list' });
  });

  it('takes everything before the first number as the project', () => {
    expect(parseFarmArgs('/farm Polymarket International 0,4 trade nhỏ')).toEqual({
      kind: 'log',
      name: 'Polymarket International',
      costUsd: 0.4,
      note: 'trade nhỏ',
    });
    expect(parseFarmArgs('/farm Symbiotic $2')).toEqual({ kind: 'log', name: 'Symbiotic', costUsd: 2, note: null });
    expect(parseFarmArgs('/farm Curvance 0')).toMatchObject({ costUsd: 0 });
  });

  it('refuses to guess without a cost or a name', () => {
    expect(parseFarmArgs('/farm Symbiotic deposit').kind).toBe('error');
    expect(parseFarmArgs('/farm 2 deposit').kind).toBe('error');
  });
});

const candidate = (name: string, tvlUsd: number, change7dPct: number | null): AirdropCandidateDTO => ({
  slug: name.toLowerCase(),
  name,
  category: 'Dexs',
  chains: ['Base'],
  tvlUsd,
  change7dPct,
  change30dPct: null,
  listedAtMs: null,
  reasons: [],
});

describe('formatAirdrops', () => {
  it('shows the biggest and the fastest-rising, and escapes names', () => {
    const text = formatAirdrops({
      enabled: true,
      day: '2026-10-21',
      fetch: null,
      candidates: [candidate('Big <x>', 500e6, -3), candidate('Hot', 20e6, 60)],
    });
    expect(text).toContain('Big &lt;x&gt;');
    expect(text).toContain('TVL tăng mạnh nhất 7 ngày');
    expect(text.indexOf('Hot', text.indexOf('tăng mạnh'))).toBeGreaterThan(-1);
  });

  it('says why the list is empty', () => {
    expect(formatAirdrops({ enabled: false, day: null, candidates: [], fetch: null })).toContain('đang tắt');
    expect(
      formatAirdrops({ enabled: true, day: null, candidates: [], fetch: { lastSuccessAt: null, consecutiveFailures: 2, lastError: 'HTTP 500' } }),
    ).toContain('HTTP 500');
  });
});

describe('formatFarms', () => {
  const farm = (overrides: Partial<FarmDTO>): FarmDTO => ({
    id: '1',
    name: 'Symbiotic',
    status: 'active',
    wallet: null,
    rewardUsd: null,
    netUsd: null,
    activity: { actionCount: 3, totalCostUsd: 4.5, activeWeeks: 2, activeMonths: 1, daysSinceLast: 20 },
    ...overrides,
  });

  it('totals cost and reward, and points out farms gone quiet', () => {
    const text = formatFarms([farm({}), farm({ id: '2', name: 'Old', status: 'claimed', rewardUsd: 50, netUsd: 45.5 })]);
    expect(text).toContain('Tổng đã tốn $9');
    expect(text).toContain('đã nhận $50');
    expect(text).toContain('lãi/lỗ +$45.5');
    expect(text).toContain('Hơn 2 tuần chưa đụng: Symbiotic');
  });
});
