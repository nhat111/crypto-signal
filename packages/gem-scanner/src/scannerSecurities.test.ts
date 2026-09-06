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

/** Deliberately shaped to PASS every market gate — the point is that it still must not be scored. */
function pair(address: string, name: string, symbol: string, overrides: Partial<GemPair> = {}): GemPair {
  return {
    chainId: 'robinhood',
    pairAddress: `pool-${address}`,
    dexId: 'uniswap',
    baseToken: { address, name, symbol },
    quoteToken: { address: 'weth', symbol: 'WETH' },
    priceUsd: 1,
    liquidityUsd: 2_000_000,
    fdvUsd: 20_000_000,
    marketCapUsd: 20_000_000,
    volume: { h1: 100_000, h6: 600_000, h24: 4_000_000 },
    priceChangePct: { m5: 0, h1: 0.1, h6: 0.4, h24: 1.8 },
    txns: { h1: { buys: 40, sells: 30 }, h24: { buys: 500, sells: 450 } },
    pairCreatedAt: NOW - 44 * DAY,
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

const noSafety: SafetySource = {
  name: 'none',
  supportsChain: () => false,
  screen: () => {
    throw new Error('should not be called');
  },
};

async function scan(pairs: GemPair[], baselineSampleSize = 10) {
  const candidates: GemCandidate[] = pairs.map((p) => ({
    chainId: 'robinhood',
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
    'robinhood',
    NOW,
  );
}

describe('runScan filters tokenized securities', () => {
  it('drops a wrapped equity that passes every market gate', async () => {
    // This is the exact shape that reached the top of /gems: inside the
    // liquidity band, real volume, a 44-day-old pool. Nothing in the market
    // gate can see what it is.
    const result = await scan([
      pair('0xspcx', 'Space Exploration Technologies Corp. Class A Common Stock', 'SPCX'),
    ]);

    expect(result.eligible).toHaveLength(0);
    expect(result.rejectedCount).toBe(1);
  });

  it('names what it dropped and which rule caught it', async () => {
    // The audit trail. A filter whose mistakes are invisible is worse than
    // no filter, because it deletes candidates and reports success.
    const result = await scan([
      pair('0xgld', 'SPDR Gold Trust', 'GLD'),
      pair('0xspcx', 'Space Exploration Technologies Corp. Class A Common Stock', 'SPCX'),
    ]);

    expect(result.filteredSecurities).toEqual([
      { symbol: 'GLD', name: 'SPDR Gold Trust', signal: 'fund issuer "spdr"' },
      {
        symbol: 'SPCX',
        name: 'Space Exploration Technologies Corp. Class A Common Stock',
        signal: 'common stock',
      },
    ]);
  });

  it('keeps a real token on the same chain', async () => {
    // Robinhood Chain is not only wrappers, and the filter must not become
    // a way of switching the chain off by accident.
    const result = await scan([pair('0xpons', 'Pons', 'PONS')]);

    expect(result.eligible.map((g) => g.pair.baseToken.symbol)).toEqual(['PONS']);
    expect(result.filteredSecurities).toEqual([]);
  });

  it('keeps a wrapped equity out of the control group', async () => {
    // The reason this filter exists at all. A control group is "what would
    // I have made in something else I could plausibly have bought" — a gold
    // ETF is not that, and averaging it in drags the comparison toward zero
    // for a reason that says nothing about the scanner.
    const result = await scan([pair('0xgld', 'SPDR Gold Trust', 'GLD')]);

    expect(result.baselineSample).toEqual([]);
  });

  it('keeps a security out of the control group even when it also fails a comparable gate', async () => {
    // 'fdv_too_high' on its own is a comparable reject. Combined with this
    // one it must not become a way back in.
    const result = await scan([
      pair('0xbrk', 'Berkshire Hathaway Inc Class B Common Shares', 'BRKB', { fdvUsd: 900_000_000 }),
    ]);

    expect(result.baselineSample).toEqual([]);
    expect(result.filteredSecurities.map((f) => f.symbol)).toEqual(['BRKB']);
  });

  it('does not accuse an ordinary reject of being a security', async () => {
    // A token rejected for its FDV is not a wrapper, and listing it under
    // "đã lọc … chứng khoán token hoá" on /status would be a false
    // accusation — the exact thing that makes somebody distrust the filter
    // and turn it off.
    const result = await scan([pair('0xbig', 'Bonk', 'BONK', { fdvUsd: 900_000_000 })]);

    expect(result.rejectedCount).toBe(1);
    expect(result.filteredSecurities).toEqual([]);
    // Still a comparable reject, so it belongs in the control group.
    expect(result.baselineSample.map((c) => c.tokenAddress)).toEqual(['0xbig']);
  });

  it('reports nothing filtered when the chain has no wrappers on it', async () => {
    const result = await scan([pair('0xa', 'Bonk', 'BONK'), pair('0xb', 'dogwifhat', 'WIF')]);

    expect(result.filteredSecurities).toEqual([]);
    expect(result.eligible).toHaveLength(2);
  });
});
