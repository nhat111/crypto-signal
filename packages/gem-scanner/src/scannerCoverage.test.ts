import { describe, expect, it } from 'vitest';
import { GEM_RISK_WEIGHTS, GEM_SCORE_WEIGHTS, type GemConfig, type GemThresholds } from './config.js';
import { runScan } from './scanner.js';
import type { CandidateDiscoverySource, SafetySource } from './types.js';

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

const config = {
  thresholds,
  scoreWeights: GEM_SCORE_WEIGHTS,
  riskWeights: GEM_RISK_WEIGHTS,
} as unknown as GemConfig;

const logs: { level: string; msg: string }[] = [];
const logger = {
  info: (_o: unknown, msg?: string) => logs.push({ level: 'info', msg: String(msg) }),
  warn: (_o: unknown, msg?: string) => logs.push({ level: 'warn', msg: String(msg) }),
  error: (_o: unknown, msg?: string) => logs.push({ level: 'error', msg: String(msg) }),
  debug: () => {},
} as never;

const noSafety: SafetySource = { name: 'none', supportsChain: () => false, screen: () => { throw new Error('unused'); } };

/** Covers every chain and finds one token. */
const covering: CandidateDiscoverySource = {
  name: 'covering',
  discoverCandidates: async () => [{ chainId: 'solana', tokenAddress: 'tok1', source: 'dexscreener_profiles' }],
};

/** Only maps solana — the shape GeckoTerminal actually has. */
const mappedOnly: CandidateDiscoverySource = {
  name: 'mappedOnly',
  supportsChain: (chainId) => chainId === 'solana',
  discoverCandidates: async () => [{ chainId: 'solana', tokenAddress: 'tok2', source: 'geckoterminal_top_pools' }],
};

/** Covers the chain, but the upstream call blows up. */
const failing: CandidateDiscoverySource = {
  name: 'failing',
  discoverCandidates: async () => {
    throw new Error('upstream 503');
  },
};

const run = (sources: CandidateDiscoverySource[], chainId: string) =>
  runScan(
    {
      discoverySources: sources,
      pairSource: { name: 'stub', fetchPairsForTokens: async () => [] },
      safetySource: noSafety,
      config,
      logger,
    },
    chainId,
  );

describe('a skipped discovery source is not the same as an empty one', () => {
  it('marks a feed that does not cover the chain', async () => {
    // The production bug: GeckoTerminal maps only solana, so on every other
    // chain it returned an empty array and recorded 0 — identical to having
    // run and found nothing. Half the discovery was off and the logs said
    // "quiet market".
    const result = await run([covering, mappedOnly], 'hyperevm');
    expect(result.candidatesBySource.mappedOnly).toBe('unsupported');
    expect(result.candidatesBySource.covering).toBe(1);
  });

  it('records a real count when the feed does cover the chain', async () => {
    const result = await run([covering, mappedOnly], 'solana');
    expect(result.candidatesBySource.mappedOnly).toBe(1);
    expect(result.candidatesBySource.covering).toBe(1);
  });

  it('reports a failed call as zero found, never as "does not cover"', async () => {
    // Different fixes: one is a missing mapping somebody must add, the
    // other is an upstream having a bad minute. Conflating them sends the
    // reader to the wrong place.
    const result = await run([failing], 'solana');
    expect(result.candidatesBySource.failing).toBe(0);
  });

  it('says loudly when no feed covers the chain at all', async () => {
    // Knowable with no network call and permanent until the config changes.
    logs.length = 0;
    const result = await run([mappedOnly], 'hyperevm');
    expect(Object.values(result.candidatesBySource)).toEqual(['unsupported']);
    expect(logs.some((l) => l.level === 'error' && l.msg.includes('no discovery source covers this chain'))).toBe(true);
  });

  it('stays quiet when at least one feed covers it', async () => {
    logs.length = 0;
    await run([covering, mappedOnly], 'hyperevm');
    expect(logs.some((l) => l.level === 'error')).toBe(false);
  });

  it('does not ask an unsupported feed for candidates', async () => {
    // Skipping has to happen before the call, or an unmapped chain still
    // spends a request against a rate-limited free API.
    let called = 0;
    const counted: CandidateDiscoverySource = {
      name: 'counted',
      supportsChain: () => false,
      discoverCandidates: async () => {
        called += 1;
        return [];
      },
    };
    await run([counted], 'hyperevm');
    expect(called).toBe(0);
  });
});
