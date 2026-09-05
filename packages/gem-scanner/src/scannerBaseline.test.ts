import { describe, expect, it } from 'vitest';
import { GEM_RISK_WEIGHTS, GEM_SCORE_WEIGHTS, type GemConfig, type GemThresholds } from './config.js';
import { runScan } from './scanner.js';
import type { GemCandidate, GemPair, SafetySource } from './types.js';

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
    priceChangePct: { m5: 0.2, h1: 1, h6: 4, h24: 12 },
    txns: { h1: { buys: 60, sells: 40 }, h24: { buys: 700, sells: 500 } },
    pairCreatedAt: NOW - 45 * DAY,
    url: null,
    fetchedAt: NOW,
    ...overrides,
  };
}

const config = {
  thresholds,
  scoreWeights: GEM_SCORE_WEIGHTS,
  riskWeights: GEM_RISK_WEIGHTS,
} as unknown as GemConfig;

const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;

/** Never screens, so nothing can be rejected for safety — this suite is about the market gate. */
const noSafety: SafetySource = {
  name: 'none',
  supportsChain: () => false,
  screen: () => {
    throw new Error('should not be called');
  },
};

async function scan(pairs: GemPair[], baselineSampleSize = 10) {
  const candidates: GemCandidate[] = pairs.map((p) => ({
    chainId: 'solana',
    tokenAddress: p.baseToken.address,
    source: 'dexscreener_profiles',
  }));
  return runScan(
    {
      discoverySources: [{ name: 'stub', discoverCandidates: async () => candidates }],
      pairSource: { name: 'stub', fetchPairsForTokens: async () => pairs },
      safetySource: noSafety,
      config,
      logger,
      baselineSampleSize,
      random: () => 0,
    },
    'solana',
    NOW,
  );
}

describe('runScan builds a control group from the right rejects', () => {
  it('keeps a token rejected for being the wrong profile', async () => {
    // Too big to be a discovery, but entirely buyable — exactly what "would
    // I have done better in something else" needs to mean.
    const result = await scan([pair('big', { fdvUsd: 500_000_000 })]);
    expect(result.eligible).toHaveLength(0);
    expect(result.baselineSample.map((c) => c.tokenAddress)).toEqual(['big']);
    expect(result.baselineSample[0]?.failures).toContain('fdv_too_high');
  });

  it('leaves out a token nobody could have traded', async () => {
    // Its printed price is not a price you could transact at, so counting
    // its "return" as the alternative would flatter the scanner with fiction.
    const result = await scan([
      pair('thin', { liquidityUsd: 1_000, volume: { h1: 0, h6: 0, h24: 100 } }),
    ]);
    expect(result.rejectedCount).toBe(1);
    expect(result.baselineSample).toHaveLength(0);
  });

  it('leaves out a token whose data was unreadable', async () => {
    const result = await scan([pair('blind', { liquidityUsd: null })]);
    expect(result.rejectedCount).toBe(1);
    expect(result.baselineSample).toHaveLength(0);
  });

  it('never puts a token the scanner surfaced into its own control group', async () => {
    // A control that contains the thing being measured is not a control.
    const result = await scan([pair('good'), pair('big', { fdvUsd: 500_000_000 })]);
    expect(result.eligible.map((g) => g.pair.baseToken.address)).toEqual(['good']);
    expect(result.baselineSample.map((c) => c.tokenAddress)).toEqual(['big']);
  });

  it('records the price it would have been bought at', async () => {
    // The later return is computed against this number, so it has to be the
    // observation and not a default.
    const result = await scan([pair('big', { fdvUsd: 500_000_000, priceUsd: 0.0425 })]);
    expect(result.baselineSample[0]?.priceUsd).toBe(0.0425);
  });

  it('caps how many it keeps per scan', async () => {
    // Every control row costs a price lookup at both horizons against a
    // rate-limited free API.
    const many = Array.from({ length: 40 }, (_, i) => pair(`big${i}`, { fdvUsd: 500_000_000 }));
    const result = await scan(many, 5);
    expect(result.rejectedCount).toBe(40);
    expect(result.baselineSample).toHaveLength(5);
  });

  it('keeps nothing when the control is switched off', async () => {
    const result = await scan([pair('big', { fdvUsd: 500_000_000 })], 0);
    expect(result.rejectedCount).toBe(1);
    expect(result.baselineSample).toHaveLength(0);
  });

  it('still counts every reject, including the ones it will not use', async () => {
    // The "we looked at N" figure must not shrink to the size of the control.
    const result = await scan([
      pair('big', { fdvUsd: 500_000_000 }),
      pair('thin', { liquidityUsd: 1_000, volume: { h1: 0, h6: 0, h24: 100 } }),
    ]);
    expect(result.rejectedCount).toBe(2);
    expect(result.baselineSample).toHaveLength(1);
  });
});
