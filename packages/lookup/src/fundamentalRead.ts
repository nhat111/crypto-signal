import type { GemPair, SafetyReport } from '@crypto-signal/gem-scanner';
import { explorerFor, type ExplorerLink } from './explorers.js';

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
  /**
   * Where to go and check any of this. Null when the chain's explorer URL
   * shape has not been verified — a wrong link makes the reader doubt the
   * address, which was the one thing that was definitely right.
   */
  explorer: ExplorerLink | null;
  /** The pool's page on the data source, for the chart and the trade history. */
  dexScreenerUrl: string | null;
  /** Links the token's own team submitted. Empty is the ordinary case. */
  websites: Array<{ label: string | null; url: string }>;
  socials: Array<{ type: string | null; url: string }>;
  unknowns: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildOnChainFundamentals(pair: GemPair, safety: SafetyReport | null, now: number): OnChainFundamentals {
  const unknowns: string[] = [];

  const ageDays = pair.pairCreatedAt === null ? null : (now - pair.pairCreatedAt) / DAY_MS;
  if (ageDays === null) unknowns.push('Pool age (nguồn không trả về ngày tạo pool)');
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

  if (explorerFor(pair.chainId, pair.baseToken.address) === null) {
    // Said out loud rather than rendered as a missing link: "we have no
    // verified explorer for this chain" is a fact about our coverage, and
    // a silently absent button reads as the token having nothing to show.
    unknowns.push(`Block explorer link (chưa có explorer nào được xác minh cho "${pair.chainId}")`);
  }
  if (pair.websites.length === 0) unknowns.push('Project website (token không khai báo website nào với nguồn dữ liệu)');

  if (safety === null) {
    unknowns.push('Safety screen (chưa nguồn nào quét được chain này)');
  } else {
    if (safety.topHolderPct === null) unknowns.push('Largest holder share (nguồn không trả về)');
    if (safety.lpLocked === null) unknowns.push('LP locked (nguồn không trả về)');
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
    explorer: explorerFor(pair.chainId, pair.baseToken.address),
    dexScreenerUrl: pair.url,
    websites: pair.websites,
    socials: pair.socials,
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
  /** The exchange's own page for the pair — the venue the candles came from. */
  exchangeUrl: string | null;
  unknowns: string[];
}

export const EXCHANGE_FUNDAMENTAL_GAPS: readonly string[] = [
  'Market cap và nguồn cung lưu hành — chưa đấu nguồn dữ liệu nào cho hai số này',
  'Lịch mở khoá token',
  'Phân bố ví nắm giữ (chỉ đọc được với token on-chain)',
];
