import { describe, expect, it } from 'vitest';
import type { CoinScanRow } from '@crypto-signal/db';
import { planCoinSetupScan } from './coinSetups.js';

const NOW = Date.UTC(2026, 9, 14, 3);
const row = (symbol: string, rs30d: number | null, over: Partial<CoinScanRow> = {}): CoinScanRow =>
  ({ day: '2026-10-13', symbol, rs30d, rsAboveSma20: true, flow: 'leverage_led', fundamentals: null, ...over }) as CoinScanRow;
const CORE = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

describe('planCoinSetupScan', () => {
  it('reads every scanned coin but the core ones, the watchlist marked and the rest kept as the baseline', () => {
    const scan = { day: '2026-10-13', rows: [row('BTCUSDT', 0), row('SOLUSDT', 40), row('OPUSDT', 54), row('STRKUSDT', 181), row('LTCUSDT', 5, { flow: 'spot_selling' })] };
    const plan = planCoinSetupScan(scan, [], CORE, 1, NOW);
    expect(plan.map((t) => `${t.symbol}:${t.cohort}:${t.detect}`)).toEqual(['OPUSDT:scan:true', 'STRKUSDT:watchlist:true', 'LTCUSDT:scan:true']);
    expect(plan[1]?.context).toEqual({ scanDay: '2026-10-13', rs30d: 181, flow: 'leverage_led' });
  });

  it('keeps resolving open setups on coins that left the scan, without looking for new ones', () => {
    const scan = { day: '2026-10-13', rows: [row('OPUSDT', 54)] };
    const open = [
      { symbol: 'OPUSDT', cohort: 'watchlist' as const },
      { symbol: 'TIAUSDT', cohort: 'scan' as const },
      { symbol: 'TIAUSDT', cohort: 'scan' as const },
      { symbol: 'SOLUSDT', cohort: 'core' as const },
    ];
    expect(planCoinSetupScan(scan, open, CORE, 6, NOW).map((t) => `${t.symbol}:${t.detect}`)).toEqual(['OPUSDT:true', 'TIAUSDT:false']);
  });

  it('stops looking for new setups on a stale scan, still resolving the open ones', () => {
    const scan = { day: '2026-10-09', rows: [row('OPUSDT', 54)] };
    expect(planCoinSetupScan(scan, [{ symbol: 'OPUSDT', cohort: 'watchlist' }], CORE, 6, NOW)).toEqual([
      { symbol: 'OPUSDT', cohort: 'watchlist', context: null, detect: false },
    ]);
    expect(planCoinSetupScan({ day: '2026-10-11', rows: [row('OPUSDT', 54)] }, [], CORE, 6, NOW)).toHaveLength(1);
    expect(planCoinSetupScan({ day: null, rows: [] }, [], CORE, 6, NOW)).toEqual([]);
  });
});
