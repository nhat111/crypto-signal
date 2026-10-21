import { describe, expect, it } from 'vitest';
import type { CoinScanDTO, LookupContextDTO, LookupDTO } from './apiClient.js';
import { escapeHtml, lookupChartUrl } from './formatting.js';
import { formatLookup } from './lookupFormat.js';

function exchange(overrides: Partial<Extract<LookupDTO['result'], { kind: 'exchange' }>['technical']> = {}): LookupDTO {
  return {
    query: 'near',
    timeframe: '4h',
    result: {
      kind: 'exchange',
      symbol: 'NEARUSDT',
      source: 'binance',
      timeframe: '4h',
      technical: {
        barCount: 200,
        lastPrice: 4.915,
        rsi14: 49.6,
        trend: { direction: 'sideways', separationPct: 0.1 },
        atrPct: 1.8,
        support: { price: 4.65, distancePct: -5.39 },
        resistance: { price: 5.12, distancePct: 4.17 },
        rangePositionPct: 61,
        missing: [],
        ...overrides,
      },
      fundamentals: { unknowns: [] },
    },
  };
}

describe('formatLookup', () => {
  it('prints support/resistance as prices with their distance, never [object Object]', () => {
    const text = formatLookup(exchange());
    expect(text).toContain('Đáy / đỉnh gần: 4.65 (-5.4%) / 5.12 (+4.2%)');
    expect(text).not.toContain('[object Object]');
  });

  it('still reads the bare numbers an older API sent', () => {
    expect(formatLookup(exchange({ support: 4.6, resistance: null }))).toContain('Đáy / đỉnh gần: 4.6 / —');
  });

  it('links to the same lookup on the web when the web URL is configured', () => {
    const text = formatLookup(exchange(), 'https://trackingticker.vercel.app');
    expect(text).toContain('📈 <a href="https://trackingticker.vercel.app/lookup?q=NEARUSDT&amp;tf=4h">Xem chart</a>');
  });

  it('sends no link when it is not', () => {
    expect(formatLookup(exchange())).not.toContain('Xem chart');
  });
});

const withContext = (context: LookupContextDTO | null | undefined): LookupDTO => {
  const data = exchange();
  if (data.result.kind === 'exchange') {
    data.result.timeframes = [
      { timeframe: '1h', trend: { direction: 'down', separationPct: -0.4 }, rsi14: 41, changePct: -1.2 },
      { timeframe: '4h', trend: { direction: 'up', separationPct: 2.9 }, rsi14: 53, changePct: 3.4 },
      { timeframe: '1d', trend: null, rsi14: null, changePct: null },
    ];
  }
  return { ...data, context };
};

const scanRow = {
  day: '2026-10-20',
  symbol: 'NEARUSDT',
  volumeRank: 5,
  futuresSymbol: null,
  close: 4.9,
  ret7d: 10.3,
  ret30d: 14.9,
  rs7d: 10.5,
  rs30d: 12.4,
  rsAboveSma20: true,
  downDayExcess: null,
  downDays: 15,
  takerSkew7d: 0.013,
  oiChange7dPct: null,
  fundingAvg7dPct: null,
  flow: 'up_unconfirmed',
  reasons: ['Spot mua/bán chủ động gần cân bằng (lệch +1.3%).'],
  unknowns: ['Không có OI và funding.'],
  fundamentals: { chain: { name: 'Near' }, protocol: null, bull: ['Phí 30 ngày +16%'], bear: [], unknowns: [] },
} as CoinScanDTO;

describe('formatLookup with what the app already stored', () => {
  it('shows the other frames, the flow read, the sectors led and the flywheel', () => {
    const text = formatLookup(
      withContext({
        coinScan: scanRow,
        coinScanDay: '2026-10-20',
        coinScanSize: 29,
        sectors: [{ categoryId: 'layer-1', name: 'Layer 1', label: 'lagging', rank: 2, change7dPct: 7.4 }],
        flywheel: { name: 'Near', symbol: 'NEAR', holdersRevenue30dUsd: 2.3e6, holdersRevenueChangePct: 81, yieldPct: 0.4 },
      }),
    );
    expect(text).toContain('Khung khác: 1h 🔴 -1.2% · 4h 🟢 +3.4% · 1d · —');
    expect(text).toContain('Tăng, spot chưa xác nhận');
    expect(text).toContain('So với BTC: 7N +10.5% · 30N +12.4%');
    expect(text).toContain('▲ Phí 30 ngày +16%');
    expect(text).toContain('Không đọc được: Không có OI và funding.');
    expect(text).toContain('Dẫn đầu mảng:</b> Layer 1 (#2, ⚪ Yếu)');
    expect(text).toContain('$2.3M về holder / 30 ngày · +81% so tháng trước · 0.4%/năm vốn hoá');
  });

  it('says plainly when the coin is outside the scan', () => {
    const text = formatLookup(withContext({ coinScan: null, coinScanDay: '2026-10-20', coinScanSize: 29, sectors: [], flywheel: null }));
    expect(text).toContain('NEAR không nằm trong top 29 coin quét ngày 20/10');
    expect(text).not.toContain('Dẫn đầu mảng');
  });

  it('adds nothing when an older API sent no context', () => {
    expect(formatLookup(withContext(undefined))).not.toContain('Dòng tiền');
  });
});

describe('lookupChartUrl', () => {
  it('builds the query the web page parses, and nothing without a base URL', () => {
    expect(lookupChartUrl('https://x.app', 'BTCUSDT', '1h')).toBe('https://x.app/lookup?q=BTCUSDT&tf=1h');
    expect(lookupChartUrl('', 'BTCUSDT', '1h')).toBeNull();
  });
});

describe('escapeHtml', () => {
  it('escapes what Telegram HTML parse mode rejects', () => {
    // A no-op version shipped in #2: a token named "A<B" or "X&Y" made
    // Telegram refuse the whole /gems message ("can't parse entities").
    expect(escapeHtml('A<B> & C')).toBe('A&lt;B&gt; &amp; C');
  });
});
