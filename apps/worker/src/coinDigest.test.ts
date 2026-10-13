import { describe, expect, it } from 'vitest';
import type { CoinScanRow } from '@crypto-signal/db';
import { formatCoinDigest } from './coinDigest.js';

function row(symbol: string, rs30d: number | null, flow: CoinScanRow['flow'] = 'quiet', exchange: CoinScanRow['exchange'] = 'binance'): CoinScanRow {
  return { symbol, rs30d, flow, exchange } as CoinScanRow;
}

describe('formatCoinDigest', () => {
  it('names the three strongest against BTC with their flow, BTC itself excluded', () => {
    const lines = formatCoinDigest(
      [row('BTCUSDT', 0), row('STRKUSDT', 178, 'leverage_led'), row('NEARUSDT', 102.6, 'spot_selling'), row('WUSDT', 79.8), row('ETHUSDT', -8), row('NEWUSDT', null)],
      [],
    );
    expect(lines[0]).toBe('🪙 <b>Top 6 coin</b>');
    expect(lines[1]).toBe('Mạnh nhất vs BTC 30N: STRK +178% (Đòn bẩy kéo) · NEAR +103% (Spot bán ròng) · W +80% (Yên ắng)');
    expect(lines.at(-1)).toBe('Chi tiết: /coins');
  });

  it('lists coins that turned to spot buying since yesterday, on the same exchange only', () => {
    const today = [row('SOLUSDT', 5, 'spot_led'), row('LINKUSDT', 2, 'accumulation'), row('ETHUSDT', 1, 'spot_led')];
    const yesterday = [row('SOLUSDT', 4, 'leverage_led'), row('LINKUSDT', 1, 'quiet'), row('ETHUSDT', 1, 'spot_led')];
    expect(formatCoinDigest(today, yesterday)).toContain('Vừa chuyển sang spot mua: SOL, LINK');

    const yesterdayOnOkx = yesterday.map((r) => ({ ...r, exchange: 'okx' as const }));
    expect(formatCoinDigest(today, yesterdayOnOkx).join('\n')).not.toContain('Vừa chuyển');
  });

  it('says when the day was read from OKX, and adds nothing without a scan', () => {
    expect(formatCoinDigest([row('BTCUSDT', 0, 'quiet', 'okx')], [])[0]).toContain('(nguồn OKX)');
    expect(formatCoinDigest([], [])).toEqual([]);
  });
});
