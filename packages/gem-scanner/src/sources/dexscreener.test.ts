import { describe, expect, it } from 'vitest';
import { __testing, toGemPair } from './dexscreener.js';

const { tokensResponseSchema } = __testing;

function rawPair(txns: unknown) {
  return {
    chainId: 'solana',
    dexId: 'raydium',
    pairAddress: 'pair1',
    baseToken: { address: 'base1', name: 'Base', symbol: 'BASE' },
    quoteToken: { address: 'quote1', symbol: 'SOL' },
    priceUsd: '0.01',
    fdv: 1000000,
    txns,
  };
}

describe('DexScreener txn windows', () => {
  it('keeps the batch when one pair reports only one side of a window', () => {
    // The schema validates the whole response as one array, so a strict
    // { buys, sells } window rejected every pair in the batch because one
    // pair omitted `sells`.
    const parsed = tokensResponseSchema.safeParse([
      rawPair({ h1: { buys: 3, sells: 2 }, h24: { buys: 10, sells: 8 } }),
      rawPair({ h1: { buys: 3 }, h24: { buys: 10, sells: 8 } }),
    ]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(toGemPair(parsed.data[0]!).txns).toEqual({
      h1: { buys: 3, sells: 2 },
      h24: { buys: 10, sells: 8 },
    });
    // A half-reported window is unknown, never a partial object.
    expect(toGemPair(parsed.data[1]!).txns).toEqual({
      h1: null,
      h24: { buys: 10, sells: 8 },
    });
  });

  it('maps missing windows to null', () => {
    const parsed = tokensResponseSchema.parse([rawPair(undefined), rawPair({ h1: null })]);
    expect(toGemPair(parsed[0]!).txns).toEqual({ h1: null, h24: null });
    expect(toGemPair(parsed[1]!).txns).toEqual({ h1: null, h24: null });
  });
});
