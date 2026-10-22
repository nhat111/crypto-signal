import { describe, expect, it } from 'vitest';
import type { CoinScanRow } from '@crypto-signal/db';
import type { OkxCoinScanData } from '@crypto-signal/market-data';
import type { CoinScanThresholds } from '@crypto-signal/shared';
import type { WatchedCoin } from './coinWatch.js';
import { formatCoinWatchIntraday, intradayFindings, okxIntradaySource, type IntradayRead } from './coinWatchIntraday.js';

const SCAN: CoinScanThresholds = { priceMovePct: 3, takerSkew: 0.03, oiRisePct: 10, oiFallPct: -10, fundingElevatedPct: 0.03, fundingShortsPayPct: -0.005 };
const T = { priceMovePct: 3, oiChangePct: 5 };
const held: WatchedCoin = { held: true, starred: false };
const star: WatchedCoin = { held: false, starred: true };

const read = (symbol: string, over: Partial<IntradayRead> = {}): IntradayRead => ({
  symbol,
  priceChangePct: 0,
  oiChangePct: 0,
  fundingSettled: [],
  fundingNow: null,
  ...over,
});
const rows = (...r: Array<Partial<CoinScanRow> & { symbol: string }>) => new Map(r.map((x) => [x.symbol, { fundingAvg7dPct: 0.001, ...x } as CoinScanRow]));

describe('intradayFindings', () => {
  it('reads price and OI since the close as the daily exit labels', () => {
    const watched = new Map([['AUSDT', held], ['BUSDT', held], ['CUSDT', held]]);
    const found = intradayFindings(
      [
        read('AUSDT', { priceChangePct: -4, oiChangePct: -6 }),
        read('BUSDT', { priceChangePct: -4, oiChangePct: 7 }),
        read('CUSDT', { priceChangePct: 5, oiChangePct: -8 }),
      ],
      rows(),
      watched,
      T,
      SCAN,
    );
    expect(found.map((f) => [f.symbol, f.kind])).toEqual([
      ['AUSDT', 'long_unwind'],
      ['BUSDT', 'shorts_building'],
      ['CUSDT', 'short_covering'],
    ]);
    expect(found[0]?.reason).toContain('giá -4.0%, OI -6.0%');
  });

  it('stays quiet under the thresholds, on a rise with OI, and without OI', () => {
    const watched = new Map([['AUSDT', held], ['BUSDT', held], ['CUSDT', held]]);
    const found = intradayFindings(
      [
        read('AUSDT', { priceChangePct: -2.9, oiChangePct: -20 }),
        read('BUSDT', { priceChangePct: 6, oiChangePct: 9 }),
        read('CUSDT', { priceChangePct: -9, oiChangePct: null }),
      ],
      rows(),
      watched,
      T,
      SCAN,
    );
    expect(found).toEqual([]);
  });

  it('reports a funding flip only when shorts were paying and a settled print is positive', () => {
    const watched = new Map([['AUSDT', star], ['BUSDT', star], ['CUSDT', star], ['DUSDT', star]]);
    const stored = rows({ symbol: 'AUSDT', fundingAvg7dPct: -0.02 }, { symbol: 'BUSDT', fundingAvg7dPct: -0.02 }, { symbol: 'CUSDT', fundingAvg7dPct: 0.001 }, { symbol: 'DUSDT', fundingAvg7dPct: -0.02 });
    const found = intradayFindings(
      [
        read('AUSDT', { fundingSettled: [0.0001], fundingNow: 0.00005 }),
        // Only the running estimate turned: not settled yet.
        read('BUSDT', { fundingSettled: [], fundingNow: 0.0001 }),
        read('CUSDT', { fundingSettled: [0.0001], fundingNow: 0.0001 }),
        read('DUSDT', { fundingSettled: [0.0001], fundingNow: -0.0001 }),
      ],
      stored,
      watched,
      T,
      SCAN,
    );
    expect(found.map((f) => [f.symbol, f.kind])).toEqual([['AUSDT', 'funding_flip']]);
    expect(found[0]?.reason).toContain('-0.0200%/8h');
    expect(found[0]?.reason).toContain('0.0100%/kỳ');
  });

  it('ignores coins nobody watches and puts held coins first', () => {
    const watched = new Map([['ZUSDT', held], ['AUSDT', star]]);
    const found = intradayFindings(
      [read('AUSDT', { priceChangePct: -4, oiChangePct: -6 }), read('ZUSDT', { priceChangePct: -4, oiChangePct: -6 }), read('XUSDT', { priceChangePct: -4, oiChangePct: -6 })],
      rows(),
      watched,
      T,
      SCAN,
    );
    expect(found.map((f) => f.symbol)).toEqual(['ZUSDT', 'AUSDT']);
  });
});

describe('formatCoinWatchIntraday', () => {
  it('groups findings per coin and says what it measures', () => {
    const text = formatCoinWatchIntraday(
      [
        { symbol: 'SOLUSDT', watched: held, kind: 'long_unwind', reason: 'a' },
        { symbol: 'SOLUSDT', watched: held, kind: 'funding_flip', reason: 'b' },
      ],
      '2026-10-21',
    );
    expect(text).toContain('đóng nến 21/10');
    expect(text?.match(/<b>SOL<\/b>/g)).toHaveLength(1);
    expect(text).toContain('• a\n• b');
    expect(text).toContain('Không phải lệnh bán');
    expect(formatCoinWatchIntraday([], '2026-10-21')).toBeNull();
  });
});

describe('okxIntradaySource', () => {
  const NOW = Date.UTC(2026, 9, 22, 10);
  const today = Date.UTC(2026, 9, 22);
  const okx = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      spotSinceDailyClose: async () => ({ last: 95, dailyClose: 100 }),
      dailyOpenInterest: async () => [
        { time: today - 86_400_000, coins: 1000 },
        { time: today, coins: 900 },
      ],
      fundingHistory: async (_s: string, start: number) => (start > today ? [{ fundingTime: today + 8 * 3_600_000, fundingRate: 0.0001 }] : []),
      currentFunding: async () => 0.00002,
      ...over,
    }) as unknown as OkxCoinScanData;

  it('measures price and OI from the close and keeps only funding settled after it', async () => {
    const r = await okxIntradaySource(okx()).read('SOLUSDT', NOW);
    expect(r?.priceChangePct).toBeCloseTo(-5);
    expect(r?.oiChangePct).toBeCloseTo(-10);
    expect(r).toMatchObject({ symbol: 'SOLUSDT', fundingSettled: [0.0001], fundingNow: 0.00002 });
  });

  it('leaves OI and funding out for a coin with no perpetual, and skips one with no spot pair', async () => {
    const noPerp = await okxIntradaySource(okx({ dailyOpenInterest: async () => [], currentFunding: async () => 1 })).read('XUSDT', NOW);
    expect(noPerp).toMatchObject({ oiChangePct: null, fundingSettled: [], fundingNow: null });
    expect(await okxIntradaySource(okx({ spotSinceDailyClose: async () => null })).read('XUSDT', NOW)).toBeNull();
  });
});
