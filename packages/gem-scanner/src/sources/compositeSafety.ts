import type { Logger } from '@crypto-signal/shared';
import type { ChainId, SafetyReport, SafetySource } from '../types.js';

/**
 * Routes a token to whichever safety source covers its chain.
 *
 * The scanner takes one safety source, and there are now two — RugCheck
 * for Solana, GoPlus for EVM — with no overlap. Rather than teach the
 * scanner about a list (and make every caller decide the routing), this
 * *is* a SafetySource: same interface, one delegate per chain.
 *
 * The important part is the fallthrough. A chain nothing covers must
 * return `unknown` with a reason, never throw and never quietly report
 * safe — that is the same rule each individual source follows, and it has
 * to survive being composed.
 */
export class CompositeSafetySource implements SafetySource {
  readonly name = 'composite';

  constructor(
    private readonly sources: SafetySource[],
    private readonly logger: Logger,
  ) {}

  supportsChain(chainId: ChainId): boolean {
    return this.sources.some((s) => s.supportsChain(chainId));
  }

  async screen(chainId: ChainId, tokenAddress: string): Promise<SafetyReport> {
    const source = this.sources.find((s) => s.supportsChain(chainId));

    if (!source) {
      // Reached only if a caller screens without checking supportsChain
      // first. Reporting rather than throwing, because a scan must not die
      // over a chain nobody screens — it must surface the token as
      // unverified.
      this.logger.warn({ chainId, tokenAddress }, 'no safety source covers this chain — reporting unknown, not safe');
      return {
        chainId,
        tokenAddress,
        verdict: 'unknown',
        flags: [`Safety screening is not available for ${chainId} — this token was not checked.`],
        topHolderPct: null,
        lpLocked: null,
        mintAuthorityRevoked: null,
        freezeAuthorityRevoked: null,
        checkedAt: Date.now(),
      };
    }

    return source.screen(chainId, tokenAddress);
  }
}
