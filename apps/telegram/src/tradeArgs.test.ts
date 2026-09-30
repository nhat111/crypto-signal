import { describe, expect, it } from 'vitest';
import { parseTradeArgs } from './tradeArgs.js';

describe('parseTradeArgs', () => {
  it('reads the original four-argument form unchanged', () => {
    expect(parseTradeArgs('/trade BTCUSDT spot 78000 0.1')).toEqual({
      ok: true,
      args: { symbol: 'BTCUSDT', side: 'spot', entryPrice: 78000, size: 0.1, source: null, thesis: null },
    });
  });

  it('takes a multi-word source and a thesis after the pipe', () => {
    const r = parseTradeArgs('/trade SOLUSDT spot 150 2 tự phân tích | hồi về hỗ trợ 1D, BTC trên EMA200');
    expect(r).toMatchObject({ ok: true, args: { size: 2, source: 'tự phân tích', thesis: 'hồi về hỗ trợ 1D, BTC trên EMA200' } });
  });

  it('lets a source follow the price when no size is given', () => {
    expect(parseTradeArgs('/trade ETHUSDT spot 3000 @CryptoCred')).toMatchObject({
      ok: true,
      args: { size: null, source: '@CryptoCred', thesis: null },
    });
  });

  it('reads a comma decimal as a decimal', () => {
    expect(parseTradeArgs('/trade PEPE spot 0,00001')).toMatchObject({ ok: true, args: { entryPrice: 0.00001 } });
  });

  it('keeps a contract address as typed and accepts the bot-mention form', () => {
    expect(parseTradeArgs('/trade@my_bot bdm98av7y3geqrhnn3f8uvcdlxngm7x spot 0.004')).toMatchObject({
      ok: true,
      args: { symbol: 'bdm98av7y3geqrhnn3f8uvcdlxngm7x' },
    });
  });

  it('refuses a missing or non-positive price and an unknown side', () => {
    expect(parseTradeArgs('/trade BTCUSDT spot')).toEqual({ ok: false });
    expect(parseTradeArgs('/trade BTCUSDT spot 0')).toEqual({ ok: false });
    expect(parseTradeArgs('/trade BTCUSDT buy 78000')).toEqual({ ok: false });
  });
});
