import { describe, expect, it } from 'vitest';
import type { TradeDTO, TradeSummaryDTO } from './apiClient.js';
import { formatJournal, formatTradeClosed, formatTradeOpened, formatTradeStop } from './formatting.js';

const trade = (over: Partial<TradeDTO> = {}): TradeDTO => ({
  id: '1',
  chatId: '1',
  symbol: 'SOLUSDT',
  side: 'spot',
  entryPrice: 150,
  exitPrice: null,
  size: 2,
  pnlPct: null,
  pnlUsd: null,
  status: 'open',
  note: null,
  openedAt: 0,
  closedAt: null,
  ...over,
});

describe('trade stop lines', () => {
  it('says how to add a stop when there is none, and older payloads read the same', () => {
    expect(formatTradeStop(trade())[0]).toContain('/stop SOLUSDT GIÁ');
    expect(formatTradeStop(trade({ stopPrice: null }))[0]).toContain('Chưa có stop');
  });

  it('prices the stop against the /risk rule and flags a trade over it', () => {
    const within = formatTradeStop(trade({ stopPrice: 140, riskUsd: 20 }), { accountUsd: 2000, riskPct: 1 });
    expect(within.join('\n')).toContain('cách giá vào 6.7%');
    expect(within.join('\n')).toContain('= 1.00% vốn');
    expect(within.join('\n')).not.toContain('⚠️');
    const over = formatTradeStop(trade({ stopPrice: 140, riskUsd: 60 }), { accountUsd: 2000, riskPct: 1 });
    expect(over.join('\n')).toContain('gấp 3.0 lần');
  });

  it('says the $ risk is unknown without a size', () => {
    expect(formatTradeStop(trade({ stopPrice: 140, riskUsd: null, size: null })).join('\n')).toContain('Chưa ghi size');
  });

  it('shows the stop on the opened message', () => {
    expect(formatTradeOpened(trade({ stopPrice: 140, riskUsd: 20 }))).toContain('Stop: $140');
  });
});

describe('results in R', () => {
  it('shows R on a close and calls out a loss past the stop', () => {
    expect(formatTradeClosed(trade({ status: 'closed', exitPrice: 170, pnlPct: 13.3, rMultiple: 2 }))).toContain('Kết quả: <b>+2.00R</b>');
    expect(formatTradeClosed(trade({ status: 'closed', exitPrice: 120, pnlPct: -20, rMultiple: -3 }))).toContain('lỗ quá mức stop');
    expect(formatTradeClosed(trade({ status: 'closed', exitPrice: 170, pnlPct: 13.3 }))).not.toContain('Kết quả');
  });

  it('adds the average R to the journal and the stop to open lines', () => {
    const summary: TradeSummaryDTO = { openCount: 1, closedCount: 2, wins: 1, losses: 1, winRatePct: 50, totalPnlUsd: null, avgPnlPct: 1, avgR: 0.5, rCount: 2 };
    const text = formatJournal([trade({ stopPrice: 140 }), trade({ id: '2', symbol: 'OPUSDT' })], summary);
    expect(text).toContain('Trung bình theo R: <b>+0.50R</b> (2 lệnh có stop)');
    expect(text).toContain('stop $140');
    expect(text).toContain('chưa có stop');
  });
});
