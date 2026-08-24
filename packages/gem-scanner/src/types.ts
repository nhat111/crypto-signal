/**
 * Domain types for the small-cap discovery ("hidden gem") scanner.
 *
 * Deliberately separate from the Binance market-health domain: nothing here
 * has funding, open interest, or a spot-vs-futures divergence, because
 * these tokens trade only on DEXes. The two products share infrastructure
 * (worker, db, api, bot, web) and the same discipline — deterministic
 * scoring, explainable reasons, no claim of edge without recorded outcomes
 * — but not their data models.
 */

/** DexScreener's `chainId`. Solana is the only one wired up today; the string type keeps adding a chain a config change (see ASSUMPTIONS.md §16). */
export type ChainId = string;

/**
 * One trading pair as normalized from a market-data source. Field names are
 * ours, not the upstream API's — the adapters translate, so a source
 * changing its shape is contained to one file.
 */
export interface GemPair {
  chainId: ChainId;
  /** The DEX pool/pair address. */
  pairAddress: string;
  dexId: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd: number | null;
  /** Total pool liquidity in USD. Null when the source doesn't report it — never defaulted to 0, which would read as "no liquidity" rather than "unknown". */
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volume: { h1: number | null; h6: number | null; h24: number | null };
  priceChangePct: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  /**
   * Buy/sell transaction counts per window. This is the closest DEX
   * analogue to the taker-side data the Binance side uses for CVD — real
   * counted trades per side, never inferred from candle color (the
   * project's core rule, spec §5/§38). It counts transactions, not volume,
   * so it says nothing about size — see ASSUMPTIONS.md §16.
   */
  txns: { h1: { buys: number; sells: number } | null; h24: { buys: number; sells: number } | null };
  /** Pool creation time (UTC ms). Null when the source omits it — age-based scoring is then unavailable rather than assumed. */
  pairCreatedAt: number | null;
  url: string | null;
  fetchedAt: number;
}

export type SafetyVerdict = 'safe' | 'caution' | 'danger' | 'unknown';

/**
 * Result of a token-safety screen. `unknown` is a first-class outcome: a
 * screen that could not run is never reported as "safe" (ASSUMPTIONS.md
 * §16), and the scoring gate treats it accordingly.
 */
export interface SafetyReport {
  chainId: ChainId;
  tokenAddress: string;
  verdict: SafetyVerdict;
  /** Individual problems found, in plain language, for the explainable reasons list. */
  flags: string[];
  /** Fraction of supply held by the top holders, 0-1. Null when the screen didn't report it. */
  topHolderPct: number | null;
  /** True only when positively confirmed; null means "not reported", which is not the same as false. */
  lpLocked: boolean | null;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  checkedAt: number;
}

/** A discovery candidate before enrichment — just enough to look it up. */
export interface GemCandidate {
  chainId: ChainId;
  tokenAddress: string;
  /** Where this candidate came from, kept so sampling bias stays visible in the data (ASSUMPTIONS.md §16). */
  source: CandidateSource;
}

export type CandidateSource = 'dexscreener_profiles' | 'dexscreener_boosts' | 'geckoterminal_top_pools';

/** Produces token addresses worth evaluating. Each feed is a *sample* of the chain, never all of it — see ASSUMPTIONS.md §16. */
export interface CandidateDiscoverySource {
  readonly name: string;
  discoverCandidates(chainId: ChainId): Promise<GemCandidate[]>;
}

/**
 * Turns candidate addresses into full pair data.
 *
 * Kept separate from discovery on purpose: candidates come from several
 * feeds, but every scored number must come from ONE source, or a "volume"
 * from one API would be silently compared against a differently-defined
 * "volume" from another.
 */
export interface PairDataSource {
  readonly name: string;
  fetchPairsForTokens(chainId: ChainId, tokenAddresses: string[]): Promise<GemPair[]>;
}

export interface MarketDataSource extends CandidateDiscoverySource, PairDataSource {}

export interface SafetySource {
  readonly name: string;
  supportsChain(chainId: ChainId): boolean;
  screen(chainId: ChainId, tokenAddress: string): Promise<SafetyReport>;
}
