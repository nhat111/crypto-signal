import { describe, expect, it } from 'vitest';
import { observationsFromPairs } from './observation.js';
import type { GemThresholds } from './config.js';
import type { GemPair } from './types.js';

const thresholds: GemThresholds = {
  minLiquidityUsd: 50_000,
  maxLiquidityUsd: 5_000_000,
  minVolume24hUsd: 25_000,
  minAgeDays: 7,
  maxFdvUsd: 50_000_000,
  idealVolumeToLiquidity: 1.5,
  maxHealthyVolumeToLiquidity: 10,
  idealAgeDays: 60,
  staleAgeDays: 365,
  verticalPump24hPct: 100,
  extremePump24hPct: 300,
};

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function pair(address: string, overrides: Partial<GemPair> = {}): GemPair {
  return {
    chainId: 'solana',
    pairAddress: `pool-${address}`,
    dexId: 'raydium',
    baseToken: { address, name: 'Test Token', symbol: 'TEST' },
    quoteToken: { address: 'sol', symbol: 'SOL' },
    priceUsd: 0.01,
    liquidityUsd: 300_000,
    fdvUsd: 5_000_000,
    marketCapUsd: 4_000_000,
    volume: { h1: 20_000, h6: 120_000, h24: 450_000 },
    priceChangePct: { m5: 0, h1: 1, h6: 4, h24: 12 },
    txns: { h1: { buys: 60, sells: 40 }, h24: { buys: 700, sells: 500 } },
    pairCreatedAt: NOW - 45 * DAY,
    url: null,
    websites: [],
    socials: [],
    fetchedAt: NOW,
    ...overrides,
  };
}

describe('observationsFromPairs', () => {
  it('records a token that still qualifies', () => {
    const [obs] = observationsFromPairs('solana', [pair('a')], thresholds, NOW);
    expect(obs).toMatchObject({
      chainId: 'solana',
      tokenAddress: 'a',
      observedAt: NOW,
      priceUsd: 0.01,
      liquidityUsd: 300_000,
      volume24hUsd: 450_000,
      eligible: true,
    });
  });

  /**
   * The whole point. This is the token the old code stopped seeing — it
   * dumped through the liquidity floor, so discovery drops it and every
   * later question about it becomes unanswerable.
   */
  it('records a token that has fallen out of the band, marked ineligible', () => {
    const [obs] = observationsFromPairs('solana', [pair('dumped', { liquidityUsd: 9_000 })], thresholds, NOW);
    expect(obs?.eligible).toBe(false);
    expect(obs?.liquidityUsd).toBe(9_000);
    expect(obs?.priceUsd).toBe(0.01);
  });

  it('recomputes eligibility rather than inheriting an old verdict', () => {
    // The same token, two observations: one while it qualified, one after
    // its volume died. A sticky "eligible" would erase the transition
    // that any later analysis is looking for.
    const healthy = observationsFromPairs('solana', [pair('x')], thresholds, NOW);
    const dead = observationsFromPairs('solana', [pair('x', { volume: { h1: 0, h6: 0, h24: 10 } })], thresholds, NOW);
    expect(healthy[0]?.eligible).toBe(true);
    expect(dead[0]?.eligible).toBe(false);
  });

  it('drops a pair with no price instead of recording zero', () => {
    // "The pool is gone" is a real outcome; "we observed a price of 0" is a
    // claim nobody made, and it would land in an average as a total loss
    // that was never measured.
    expect(observationsFromPairs('solana', [pair('gone', { priceUsd: null })], thresholds, NOW)).toEqual([]);
  });

  it('keeps the deepest pool when a token has several', () => {
    // Same rule runScan uses: the deepest pool is the price a buyer gets.
    const obs = observationsFromPairs(
      'solana',
      [
        pair('multi', { priceUsd: 1, liquidityUsd: 60_000 }),
        pair('multi', { priceUsd: 2, liquidityUsd: 900_000 }),
        pair('multi', { priceUsd: 3, liquidityUsd: 100_000 }),
      ],
      thresholds,
      NOW,
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]?.priceUsd).toBe(2);
  });

  it('does not let a priceless deep pool hide a priced shallow one', () => {
    // The null-price pool is deeper, but it cannot be observed at all —
    // skipping it before the depth comparison is what keeps the token.
    const obs = observationsFromPairs(
      'solana',
      [
        pair('multi', { priceUsd: null, liquidityUsd: 900_000 }),
        pair('multi', { priceUsd: 5, liquidityUsd: 60_000 }),
      ],
      thresholds,
      NOW,
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]?.priceUsd).toBe(5);
  });

  it('stamps every observation with the scan time, not each pair fetch time', () => {
    // One scan is one point in a series; letting rows drift by seconds
    // would break the unique constraint's job of making a retry idempotent.
    const obs = observationsFromPairs(
      'solana',
      [pair('a', { fetchedAt: NOW - 5_000 }), pair('b', { fetchedAt: NOW + 5_000 })],
      thresholds,
      NOW,
    );
    expect(obs.map((o) => o.observedAt)).toEqual([NOW, NOW]);
  });

  it('returns nothing for nothing', () => {
    expect(observationsFromPairs('solana', [], thresholds, NOW)).toEqual([]);
  });
});
