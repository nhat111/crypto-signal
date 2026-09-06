import { checkEligibility } from './scoring.js';
import type { GemThresholds } from './config.js';
import type { GemPair } from './types.js';

/**
 * One priced look at a token, whether or not it still qualifies.
 *
 * Separate from ScoredGem on purpose: that type carries a score, and a
 * token that failed the gate has no score — giving it one would put an
 * unqualified token on the same axis as a qualified one, which the scoring
 * module refuses by design.
 */
export interface PriceObservation {
  chainId: string;
  tokenAddress: string;
  observedAt: number;
  priceUsd: number;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  eligible: boolean;
}

/**
 * Turns whatever the pair source returned into observations.
 *
 * A pair with no price is dropped rather than recorded as 0: the pool
 * being gone is a real outcome, but "we observed a price of zero" is a
 * claim nobody made, and it would land in an average later as a total
 * loss that was never measured.
 *
 * Eligibility is recomputed here rather than assumed, so an observation of
 * a token that has fallen out of the band says so instead of inheriting a
 * verdict from whenever it last qualified.
 */
export function observationsFromPairs(
  chainId: string,
  pairs: GemPair[],
  thresholds: GemThresholds,
  observedAt: number,
): PriceObservation[] {
  // A token can have several pools; the deepest is the one whose price a
  // buyer would actually get, matching how runScan picks.
  const deepestByToken = new Map<string, GemPair>();
  for (const pair of pairs) {
    if (pair.priceUsd === null) continue;
    const current = deepestByToken.get(pair.baseToken.address);
    if (!current || (pair.liquidityUsd ?? 0) > (current.liquidityUsd ?? 0)) {
      deepestByToken.set(pair.baseToken.address, pair);
    }
  }

  return [...deepestByToken.values()].map((pair) => ({
    chainId,
    tokenAddress: pair.baseToken.address,
    observedAt,
    priceUsd: pair.priceUsd as number,
    liquidityUsd: pair.liquidityUsd,
    volume24hUsd: pair.volume.h24,
    eligible: checkEligibility(pair, thresholds, observedAt).length === 0,
  }));
}
