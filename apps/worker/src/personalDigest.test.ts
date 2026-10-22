import { describe, expect, it } from 'vitest';
import type { CoinScanRow, TradeRow, TradeSetupRow } from '@crypto-signal/db';
import { formatPersonalDigest, type PersonalDigestInput } from './personalDigest.js';
import { scanSymbol } from './coinScan.js';
import { formatDigest } from './trendCycle.js';

const trade = (overrides: Partial<TradeRow> = {}): TradeRow => ({
  id: '1',
  chatId: 'c1',
  symbol: 'SOL',
  side: 'spot',
  entryPrice: 140,
  exitPrice: null,
  size: 2,
  pnlPct: null,
  pnlUsd: null,
  status: 'open',
  note: null,
  source: null,
  thesis: null,
  stopPrice: null,
  rMultiple: null,
  riskUsd: null,
  openedAt: 0,
  closedAt: null,
  ...overrides,
});

const scan = (symbol: string, flow: CoinScanRow['flow'], exchange: CoinScanRow['exchange'] = 'okx'): CoinScanRow =>
  ({ symbol, flow, exchange, close: 0 }) as CoinScanRow;

const setup = (overrides: Partial<TradeSetupRow> = {}): TradeSetupRow =>
  ({ symbol: 'ETHUSDT', kind: 'pullback', entry: 2500, stop: 2400, target: 2800, detectedAt: 1, cohort: 'core', ...overrides }) as TradeSetupRow;

const input = (overrides: Partial<PersonalDigestInput> = {}): PersonalDigestInput => ({
  openTrades: [],
  prices: new Map(),
  today: [],
  previous: [],
  setups: [],
  profile: null,
  ...overrides,
});

const format = (overrides: Partial<PersonalDigestInput> = {}): string => formatPersonalDigest(input(overrides), scanSymbol).join('\n');

describe('formatPersonalDigest', () => {
  it('says there is nothing open rather than leaving the section empty', () => {
    expect(format()).toContain('Không có lệnh mở trong Journal');
    expect(format()).not.toContain('Setup 4H');
  });

  it('prices a hand-typed symbol at the day close, with % and $ and the flow change', () => {
    const text = format({
      openTrades: [trade()],
      prices: new Map([['SOLUSDT', 154]]),
      today: [scan('SOLUSDT', 'spot_led')],
      previous: [scan('SOLUSDT', 'leverage_led')],
    });
    expect(text).toContain('<b>SOL</b> spot · vào 140 → 154 (+10.0%, +28.00$) · Spot mua dẫn (hôm qua: Đòn bẩy kéo)');
  });

  it('inverts a short and leaves out a label change across exchanges', () => {
    const text = format({
      openTrades: [trade({ side: 'short', size: null })],
      prices: new Map([['SOLUSDT', 154]]),
      today: [scan('SOLUSDT', 'spot_led', 'okx')],
      previous: [scan('SOLUSDT', 'leverage_led', 'binance')],
    });
    expect(text).toContain('(-10.0%) · Spot mua dẫn');
    expect(text).not.toContain('hôm qua');
  });

  it('says when a coin has no price, and shortens a contract address', () => {
    const text = format({ openTrades: [trade({ symbol: 'So11111111111111111111111111111111111111112' })] });
    expect(text).toContain('<b>So1111…1112</b>');
    expect(text).toContain('chưa có giá');
  });

  it('caps the list and points to /journal for the rest', () => {
    const text = format({ openTrades: Array.from({ length: 10 }, (_, i) => trade({ id: String(i) })) });
    expect(text).toContain('Đang giữ 10 lệnh');
    expect(text).toContain('… và 2 lệnh khác: /journal');
  });

  it('sizes open setups for the chat account, newest first, or points to /risk', () => {
    const setups = [setup({ symbol: 'OLDUSDT', detectedAt: 1 }), setup({ symbol: 'NEWUSDT', detectedAt: 2, cohort: 'watchlist' })];
    const sized = format({ setups, profile: { accountUsd: 1000, riskPct: 1 } });
    expect(sized.indexOf('NEW')).toBeLessThan(sized.indexOf('OLD'));
    expect(sized).toContain('<b>NEW</b> Hồi về hỗ trợ ⭐ · vào ~2,500 · cắt lỗ 2,400 · chốt 2,800');
    expect(sized).toContain('Cỡ lệnh (TK 1,000$, rủi ro 1%): 0.100 NEW');
    expect(sized).not.toContain('/risk');

    const unsized = format({ setups });
    expect(unsized).not.toContain('Cỡ lệnh');
    expect(unsized).toContain('/risk VỐN %RỦI_RO');
  });

  it('goes right under the digest title', () => {
    const text = formatDigest([], [], [], Date.UTC(2026, 8, 30), [], ['👤 <b>Của bạn</b>']);
    expect(text.split('\n').slice(0, 3)).toEqual(['☀️ <b>Tóm tắt sau nến 1D ngày 29/09/2026</b>', '', '👤 <b>Của bạn</b>']);
  });
});
