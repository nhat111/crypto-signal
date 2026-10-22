import { describe, expect, it } from 'vitest';
import type { CoinScanRow } from '@crypto-signal/db';
import type { CoinScanThresholds } from '@crypto-signal/shared';
import { coinWatchChanges, formatCoinWatch, watchedCoins, type WatchedCoin } from './coinWatch.js';

const T: CoinScanThresholds = { priceMovePct: 3, takerSkew: 0.03, oiRisePct: 10, oiFallPct: -10, fundingElevatedPct: 0.03, fundingShortsPayPct: -0.005 };

function row(symbol: string, over: Partial<CoinScanRow> = {}): CoinScanRow {
  return { symbol, flow: 'leverage_led', fundingAvg7dPct: 0.001, rsAboveSma20: true, exchange: 'okx', ...over } as CoinScanRow;
}

const held: WatchedCoin = { held: true, starred: false };
const star: WatchedCoin = { held: false, starred: true };

describe('coinWatchChanges', () => {
  it('reports a turn into a flow that weakens the case for holding', () => {
    const changes = coinWatchChanges([row('STRKUSDT', { flow: 'short_covering' })], [row('STRKUSDT', { flow: 'short_squeeze' })], new Map([['STRKUSDT', held]]), new Set(), T);
    expect(changes).toEqual([{ symbol: 'STRKUSDT', watched: held, reasons: ['Nhãn đổi: Short bị ép → Short đóng lệnh.'] }]);
  });

  it('ignores flows that stay put or move somewhere harmless', () => {
    const watched = new Map([['AUSDT', held], ['BUSDT', held]]);
    const today = [row('AUSDT', { flow: 'spot_selling' }), row('BUSDT', { flow: 'spot_led' })];
    const before = [row('AUSDT', { flow: 'spot_selling' }), row('BUSDT', { flow: 'leverage_led' })];
    expect(coinWatchChanges(today, before, watched, new Set(), T)).toEqual([]);
  });

  it('reports funding flipping from shorts paying to positive, the end of a squeeze', () => {
    const [c] = coinWatchChanges([row('BATUSDT', { fundingAvg7dPct: 0.002 })], [row('BATUSDT', { fundingAvg7dPct: -0.037 })], new Map([['BATUSDT', held]]), new Set(), T);
    expect(c?.reasons).toEqual([expect.stringContaining('Funding đổi từ âm sang dương (-0.0370% → +0.0020%/8h)')]);
    // Barely negative before is not a squeeze ending.
    expect(coinWatchChanges([row('BATUSDT', { fundingAvg7dPct: 0.002 })], [row('BATUSDT', { fundingAvg7dPct: -0.001 })], new Map([['BATUSDT', held]]), new Set(), T)).toEqual([]);
  });

  it('reports the RS line falling under its 20-day average and a lost star', () => {
    const [c] = coinWatchChanges([row('OPUSDT', { rsAboveSma20: false })], [row('OPUSDT')], new Map([['OPUSDT', star]]), new Set(), T);
    expect(c?.reasons).toEqual(['Tỉ giá với BTC rơi xuống dưới trung bình 20 ngày: đà mạnh hơn BTC đang yếu đi.', 'Rớt khỏi danh sách ⭐.']);
    expect(coinWatchChanges([row('OPUSDT')], [row('OPUSDT')], new Map([['OPUSDT', star]]), new Set(['OPUSDT']), T)).toEqual([]);
  });

  it('reports a watched coin that fell out of the scan, but not one never scanned', () => {
    const watched = new Map([['BATUSDT', held], ['NEWUSDT', held]]);
    const changes = coinWatchChanges([row('STRKUSDT')], [row('STRKUSDT'), row('BATUSDT')], watched, new Set(), T);
    expect(changes).toEqual([{ symbol: 'BATUSDT', watched: held, reasons: ['Rớt khỏi nhóm coin volume lớn nhất: dòng tiền đã nguội, hôm nay không còn được quét.'] }]);
  });

  it('only looks at watched coins, and only across two days from one exchange', () => {
    const today = [row('XUSDT', { flow: 'spot_selling' })];
    expect(coinWatchChanges(today, [row('XUSDT')], new Map(), new Set(), T)).toEqual([]);
    expect(coinWatchChanges(today, [row('XUSDT', { exchange: 'binance' })], new Map([['XUSDT', held]]), new Set(), T)).toEqual([]);
    expect(coinWatchChanges(today, [], new Map([['XUSDT', held]]), new Set(), T)).toEqual([]);
  });

  it('puts held coins before watched ones', () => {
    const watched = new Map([['AUSDT', star], ['ZUSDT', held]]);
    const today = [row('AUSDT', { flow: 'spot_selling' }), row('ZUSDT', { flow: 'spot_selling' })];
    expect(coinWatchChanges(today, [row('AUSDT'), row('ZUSDT')], watched, new Set(['AUSDT']), T).map((c) => c.symbol)).toEqual(['ZUSDT', 'AUSDT']);
  });
});

describe('formatCoinWatch', () => {
  it('sends nothing without changes', () => {
    expect(formatCoinWatch([], '2026-10-14')).toBeNull();
  });

  it('names each coin with why it is watched, escaped', () => {
    const text = formatCoinWatch([{ symbol: 'BATUSDT', watched: { held: true, starred: true }, reasons: ['a < b'] }], '2026-10-14') as string;
    expect(text).toContain('(nến 14/10)');
    expect(text).toContain('<b>BAT</b> (đang giữ, ⭐)');
    expect(text).toContain('• a &lt; b');
    expect(text).toContain('không phải lệnh bán');
  });
});

describe('watchedCoins', () => {
  it('watches ⭐ coins and open longs, not shorts', () => {
    const w = watchedCoins(new Set(['OPUSDT']), [{ symbol: 'op', side: 'long' }, { symbol: 'bat', side: 'spot' }, { symbol: 'TIA', side: 'short' }], (s) => `${s.toUpperCase()}USDT`);
    expect(w).toEqual(new Map([['OPUSDT', { held: true, starred: true }], ['BATUSDT', { held: true, starred: false }]]));
  });
});
