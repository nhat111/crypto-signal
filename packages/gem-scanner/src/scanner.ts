import type { Logger } from '@crypto-signal/shared';
import type { GemConfig } from './config.js';
import { evaluateGem, type GemEvaluation } from './scoring.js';
import type { CandidateDiscoverySource, ChainId, GemPair, PairDataSource, SafetyReport, SafetySource } from './types.js';

export interface ScanResult {
  chainId: ChainId;
  scannedAt: number;
  /** How many candidates each discovery feed produced, so sampling coverage stays visible rather than implied. */
  candidatesBySource: Record<string, number>;
  candidateCount: number;
  pairCount: number;
  eligible: ScoredGem[];
  /** Candidates that failed the gate, kept so the UI can honestly say "we looked at N and N-k didn't qualify". */
  rejectedCount: number;
}

export interface ScoredGem {
  pair: GemPair;
  evaluation: GemEvaluation;
  /** Carried through so the persisted row records what the screen actually found, rather than the caller having to re-screen. Null when no screen ran for this chain. */
  safety: SafetyReport | null;
}

export interface ScannerDeps {
  discoverySources: CandidateDiscoverySource[];
  pairSource: PairDataSource;
  safetySource: SafetySource | null;
  config: GemConfig;
  logger: Logger;
}

/**
 * One full scan pass for a chain: discover candidates from every feed,
 * enrich them through a single pair-data source, screen the survivors for
 * safety, then score.
 *
 * Safety screening runs only on candidates that already passed the market
 * gate. That ordering is deliberate — the safety API is the slowest and
 * most rate-limited dependency, and screening tokens that were never going
 * to qualify would burn that budget for nothing.
 */
export async function runScan(deps: ScannerDeps, chainId: ChainId, now = Date.now()): Promise<ScanResult> {
  const { logger, config } = deps;

  const candidatesBySource: Record<string, number> = {};
  const addresses = new Set<string>();

  for (const source of deps.discoverySources) {
    try {
      const found = await source.discoverCandidates(chainId);
      candidatesBySource[source.name] = found.length;
      for (const c of found) addresses.add(c.tokenAddress);
    } catch (err) {
      candidatesBySource[source.name] = 0;
      logger.warn({ err, source: source.name, chainId }, 'discovery source failed, continuing with the others');
    }
  }

  const tokenAddresses = [...addresses];
  logger.info({ chainId, candidateCount: tokenAddresses.length, candidatesBySource }, 'gem scan: candidates discovered');

  if (tokenAddresses.length === 0) {
    return { chainId, scannedAt: now, candidatesBySource, candidateCount: 0, pairCount: 0, eligible: [], rejectedCount: 0 };
  }

  const pairs = await deps.pairSource.fetchPairsForTokens(chainId, tokenAddresses);

  // A token can have several pools; keep only its deepest, which is the one
  // a buyer would actually trade and the one whose liquidity is meaningful.
  const bestPairByToken = new Map<string, GemPair>();
  for (const pair of pairs) {
    const key = pair.baseToken.address;
    const current = bestPairByToken.get(key);
    if (!current || (pair.liquidityUsd ?? 0) > (current.liquidityUsd ?? 0)) {
      bestPairByToken.set(key, pair);
    }
  }

  const scored: ScoredGem[] = [];
  let rejectedCount = 0;

  for (const pair of bestPairByToken.values()) {
    // Cheap market gate first, with no safety data — if it fails here it
    // fails regardless of safety, so there's nothing to spend an API call on.
    const preCheck = evaluateGem({
      pair,
      safety: null,
      thresholds: config.thresholds,
      scoreWeights: config.scoreWeights,
      riskWeights: config.riskWeights,
      now,
    });

    if (!preCheck.eligible) {
      rejectedCount += 1;
      continue;
    }

    let safety: SafetyReport | null = null;
    if (deps.safetySource?.supportsChain(chainId)) {
      safety = await deps.safetySource.screen(chainId, pair.baseToken.address);
    }

    const evaluation = evaluateGem({
      pair,
      safety,
      thresholds: config.thresholds,
      scoreWeights: config.scoreWeights,
      riskWeights: config.riskWeights,
      now,
    });

    if (evaluation.eligible) scored.push({ pair, evaluation, safety });
    else rejectedCount += 1;
  }

  scored.sort((a, b) => (b.evaluation.score ?? 0) - (a.evaluation.score ?? 0));

  logger.info(
    { chainId, pairCount: bestPairByToken.size, eligible: scored.length, rejectedCount },
    'gem scan: scoring complete',
  );

  return {
    chainId,
    scannedAt: now,
    candidatesBySource,
    candidateCount: tokenAddresses.length,
    pairCount: bestPairByToken.size,
    eligible: scored,
    rejectedCount,
  };
}
