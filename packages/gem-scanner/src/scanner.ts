import type { Logger } from '@crypto-signal/shared';
import type { GemConfig } from './config.js';
import { evaluateGem, type EligibilityFailure, type GemEvaluation } from './scoring.js';
import { isComparableReject, sampleRejects } from './baseline.js';
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
  /**
   * A bounded sample of rejects worth pricing later as a control group.
   * See baseline.ts for why only some rejections qualify.
   */
  baselineSample: RejectedCandidate[];
}

/** One control-group member: a token that was the wrong profile, not an unreadable or untradeable one. */
export interface RejectedCandidate {
  chainId: ChainId;
  tokenAddress: string;
  priceUsd: number;
  liquidityUsd: number | null;
  failures: EligibilityFailure[];
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
  /**
   * How many rejected candidates to keep per scan as a control. Bounded so
   * the baseline costs a fixed number of rows and price lookups however
   * many candidates were rejected. 0 switches the control off.
   */
  baselineSampleSize?: number;
  /** Injected so a test can make the sampling deterministic. */
  random?: () => number;
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
    return { chainId, scannedAt: now, candidatesBySource, candidateCount: 0, pairCount: 0, eligible: [], rejectedCount: 0, baselineSample: [] };
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
  const comparableRejects: RejectedCandidate[] = [];
  let rejectedCount = 0;

  const noteReject = (pair: GemPair, failures: EligibilityFailure[]): void => {
    rejectedCount += 1;
    if (!isComparableReject(failures, pair.priceUsd)) return;
    comparableRejects.push({
      chainId,
      tokenAddress: pair.baseToken.address,
      priceUsd: pair.priceUsd as number,
      liquidityUsd: pair.liquidityUsd,
      failures,
    });
  };

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
      noteReject(pair, preCheck.failures);
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
    // Rejected only after a safety screen ran: not a profile rejection, so
    // it is counted but never used as a control (see baseline.ts).
    else rejectedCount += 1;
  }

  scored.sort((a, b) => (b.evaluation.score ?? 0) - (a.evaluation.score ?? 0));

  const baselineSample = sampleRejects(comparableRejects, deps.baselineSampleSize ?? 0, deps.random);

  logger.info(
    { chainId, pairCount: bestPairByToken.size, eligible: scored.length, rejectedCount, baselineSample: baselineSample.length },
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
    baselineSample,
  };
}
