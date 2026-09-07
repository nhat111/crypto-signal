import { describe, expect, it } from 'vitest';
import { EXPLORER_CHAINS, binanceTradeUrl, explorerFor } from './explorers.js';
import { QUOTE_FALLBACKS } from './resolveQuery.js';

describe('explorerFor', () => {
  it('builds a token page for a chain it is sure about', () => {
    expect(explorerFor('solana', 'ABC')).toEqual({ name: 'Solscan', url: 'https://solscan.io/token/ABC' });
    expect(explorerFor('bsc', '0xabc')?.url).toBe('https://bscscan.com/token/0xabc');
  });

  it('accepts the chain id in any casing', () => {
    expect(explorerFor('BSC', '0xabc')?.name).toBe('BscScan');
  });

  /**
   * The reason this is a list and not a pattern. A wrong explorer lands on
   * "not found" and makes the reader doubt the ADDRESS, which was the one
   * thing that was definitely right.
   */
  it('says nothing for a chain whose explorer has not been verified', () => {
    expect(explorerFor('robinhood', '0xabc')).toBeNull();
    expect(explorerFor('hyperevm', '0xabc')).toBeNull();
    expect(explorerFor('', '0xabc')).toBeNull();
  });

  it('refuses to build a link with no address in it', () => {
    expect(explorerFor('solana', '')).toBeNull();
    expect(explorerFor('solana', '   ')).toBeNull();
  });

  it('escapes the address rather than pasting it into a URL raw', () => {
    expect(explorerFor('solana', 'a b/c')?.url).toBe('https://solscan.io/token/a%20b%2Fc');
  });

  it('covers the chains the scanner can actually screen', () => {
    // Not a coverage target for its own sake: these are the chains whose
    // safety verdicts the page shows, and a verdict with nowhere to check
    // it is the thing being fixed.
    for (const chain of ['solana', 'bsc', 'ethereum', 'base']) {
      expect(EXPLORER_CHAINS, `${chain} should have an explorer`).toContain(chain);
    }
  });
});

describe('binanceTradeUrl', () => {
  it('splits the pair on its quote asset', () => {
    expect(binanceTradeUrl('BTCUSDT', QUOTE_FALLBACKS)).toBe('https://www.binance.com/en/trade/BTC_USDT');
    expect(binanceTradeUrl('NEARUSDC', QUOTE_FALLBACKS)).toBe('https://www.binance.com/en/trade/NEAR_USDC');
  });

  it('says nothing for a symbol whose quote it cannot identify', () => {
    // Better no link than one to a pair that does not exist.
    expect(binanceTradeUrl('WEIRD', QUOTE_FALLBACKS)).toBeNull();
  });

  it('does not treat the quote asset alone as a pair', () => {
    expect(binanceTradeUrl('USDT', QUOTE_FALLBACKS)).toBeNull();
  });
});
