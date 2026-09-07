import type { GemPair, SafetyReport } from '@crypto-signal/gem-scanner';

/**
 * What can honestly be said about a token beyond its chart.
 *
 * "Fundamental analysis" in equities means earnings, debt and cash flow.
 * A token has none of those, and pretending otherwise is how a confident
 * paragraph gets written about nothing. What a DEX token does have is
 * measurable and it is here: how much money is actually in the pool, what
 * the pool is worth against the token's valuation, who holds the supply,
 * whether the contract lets a buyer sell, and how long any of it has
 * existed.
 *
 * Everything that could not be read is listed in `unknowns` rather than
 * omitted. An absent holder distribution and a healthy one look the same
 * on a page that only prints what it found.
 */
export interface OnChainFundamentals {
  chainId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  dexId: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  ageDays: number | null;
  /** Pool depth against valuation. Below a few percent, the price is thin relative to what the token claims to be worth. */
  liquidityToFdvPct: number | null;
  /** Daily turnover against pool depth. Very high means the pool is being churned; very low means nobody is trading it. */
  volumeToLiquidity: number | null;
  buys24h: number | null;
  sells24h: number | null;
  safetyVerdict: SafetyReport['verdict'] | null;
  safetyFlags: string[];
  topHolderPct: number | null;
  lpLocked: boolean | null;
  mintAuthorityRevoked: boolean | null;
  freezeAuthorityRevoked: boolean | null;
  unknowns: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildOnChainFundamentals(pair: GemPair, safety: SafetyReport | null, now: number): OnChainFundamentals {
  const unknowns: string[] = [];

  const ageDays = pair.pairCreatedAt === null ? null : (now - pair.pairCreatedAt) / DAY_MS;
  if (ageDays === null) unknowns.push('Pool age (the source returned no creation date)');
  if (pair.liquidityUsd === null) unknowns.push('Liquidity');
  if (pair.fdvUsd === null) unknowns.push('FDV');
  if (pair.marketCapUsd === null) unknowns.push('Circulating market cap');
  if (pair.volume.h24 === null) unknowns.push('24h volume');

  // Ratios only where BOTH sides are real. A ratio computed against a
  // missing denominator is not a small number, it is not a number.
  const liquidityToFdvPct =
    pair.liquidityUsd !== null && pair.fdvUsd !== null && pair.fdvUsd > 0
      ? (pair.liquidityUsd / pair.fdvUsd) * 100
      : null;
  const volumeToLiquidity =
    pair.volume.h24 !== null && pair.liquidityUsd !== null && pair.liquidityUsd > 0
      ? pair.volume.h24 / pair.liquidityUsd
      : null;

  if (safety === null) {
    unknowns.push('Safety screen (no source covers this chain)');
  } else {
    if (safety.topHolderPct === null) unknowns.push('Largest holder share');
    if (safety.lpLocked === null) unknowns.push('Whether LP is locked');
  }

  return {
    chainId: pair.chainId,
    tokenAddress: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    dexId: pair.dexId,
    priceUsd: pair.priceUsd,
    liquidityUsd: pair.liquidityUsd,
    fdvUsd: pair.fdvUsd,
    marketCapUsd: pair.marketCapUsd,
    volume24hUsd: pair.volume.h24,
    ageDays,
    liquidityToFdvPct,
    volumeToLiquidity,
    buys24h: pair.txns.h24?.buys ?? null,
    sells24h: pair.txns.h24?.sells ?? null,
    safetyVerdict: safety?.verdict ?? null,
    safetyFlags: safety?.flags ?? [],
    topHolderPct: safety?.topHolderPct ?? null,
    lpLocked: safety?.lpLocked ?? null,
    mintAuthorityRevoked: safety?.mintAuthorityRevoked ?? null,
    freezeAuthorityRevoked: safety?.freezeAuthorityRevoked ?? null,
    unknowns,
  };
}

/**
 * What an exchange-listed ticker offers instead.
 *
 * Deliberately thin, and it says so. Circulating supply, market cap and
 * token unlocks would need a data source this project does not have wired
 * — and inventing a market cap from a price is exactly the kind of
 * confident wrong number the rest of this codebase refuses to print.
 */
export interface ExchangeFundamentals {
  symbol: string;
  spotListed: boolean;
  futuresListed: boolean;
  quoteVolume24hUsd: number | null;
  fundingRate: number | null;
  openInterest: number | null;
  unknowns: string[];
}

export const EXCHANGE_FUNDAMENTAL_GAPS: readonly string[] = [
  'Market cap and circulating supply — no data source is wired for these',
  'Token unlock schedule',
  'Holder distribution (readable only for on-chain tokens)',
];
