import { describe, expect, it } from 'vitest';
import type { CoinScanDTO, CoinsResponseDTO } from './apiClient.js';
import { coinArg, formatCoinDetail, formatCoins } from './coinsFormat.js';

function row(symbol: string, rs30d: number | null, overrides: Partial<CoinScanDTO> = {}): CoinScanDTO {
  return {
    day: '2026-10-12',
    symbol,
    volumeRank: 1,
    futuresSymbol: symbol,
    close: 1,
    ret7d: 2,
    ret30d: 5,
    rs7d: rs30d === null ? 1.5 : rs30d / 2,
    rs30d,
    rsAboveSma20: true,
    downDayExcess: null,
    downDays: 0,
    takerSkew7d: 0,
    oiChange7dPct: 0,
    fundingAvg7dPct: 0.01,
    flow: 'quiet',
    reasons: ['Giá 7 ngày +2.0%.'],
    unknowns: [],
    ...overrides,
  };
}

const data = (rows: CoinScanDTO[]): CoinsResponseDTO => ({ enabled: true, day: '2026-10-12', rows, fetch: null });

describe('formatCoins', () => {
  it('ranks against BTC, keeps BTC out of the ranking, and lists the weakest separately', () => {
    const rows = [
      row('BTCUSDT', 0, { flow: 'spot_led' }),
      ...Array.from({ length: 12 }, (_, i) => row(`C${i}USDT`, i - 5)),
      row('NEWUSDT', null, { flow: 'spot_led' }),
    ];
    const text = formatCoins(data(rows));
    expect(text).toContain('nến 1D đến 12/10');
    expect(text).toContain('BTC: 7N +2.0% · 30N +5.0% · 🟢 Spot mua dẫn');
    const strong = text.slice(text.indexOf('Mạnh nhất'), text.indexOf('Yếu nhất'));
    expect(strong.split('\n')[1]).toContain('<b>C11</b> +6.0% vs BTC 30N');
    expect(strong).not.toContain('<b>BTC</b>');
    // A coin under a month old is ranked on 7 days and says so.
    expect(text).toContain('<b>NEW</b> +1.5% vs BTC 7N');
    const weak = text.slice(text.indexOf('Yếu nhất'));
    expect(weak.split('\n')[1]).toContain('<b>C0</b> -5.0%');
    expect(text).toContain('Spot mua ròng 7 ngày: BTC, NEW');
  });

  it('says when the day was read from OKX instead of Binance', () => {
    const rows = [row('BTCUSDT', 0), row('SOLUSDT', 5)];
    expect(formatCoins({ ...data(rows), exchange: 'okx' })).toContain('Nguồn: OKX');
    expect(formatCoins(data(rows))).not.toContain('OKX');
    expect(formatCoinDetail({ ...data(rows), exchange: 'okx' }, 'SOLUSDT')).toContain('Hạng volume #1 trên OKX');
  });

  it('says why the list is empty', () => {
    expect(formatCoins({ enabled: false, day: null, rows: [], fetch: null })).toContain('đang tắt');
    const failing = formatCoins({ enabled: true, day: null, rows: [], fetch: { lastSuccessAt: null, consecutiveFailures: 2, lastError: 'IP <banned>' } });
    expect(failing).toContain('Chưa có lần quét');
    expect(failing).toContain('IP &lt;banned&gt;');
  });
});

describe('formatCoinDetail', () => {
  it('prints the reasons and what could not be read', () => {
    const text = formatCoinDetail(data([row('SOLUSDT', 12, { flow: 'leverage_led', unknowns: ['Không đọc được funding 7 ngày.'] })]), 'SOLUSDT');
    expect(text).toContain('<b>SOL</b> — 🟠 Đòn bẩy kéo');
    expect(text).toContain('So với BTC: 7N +6.0% · 30N +12.0%');
    expect(text).toContain('• Giá 7 ngày +2.0%.');
    expect(text).toContain('Không đọc được:\n• Không đọc được funding 7 ngày.');
  });

  it('says when the coin is outside the scanned list', () => {
    expect(formatCoinDetail(data([row('BTCUSDT', 0)]), 'XYZUSDT')).toContain('XYZ không nằm trong top 1');
  });
});

describe('coinArg', () => {
  it('accepts the ticker however it is typed', () => {
    expect(coinArg('/coins sol')).toBe('SOLUSDT');
    expect(coinArg('/coins SOLUSDT')).toBe('SOLUSDT');
    expect(coinArg('/coins')).toBeNull();
  });
});
