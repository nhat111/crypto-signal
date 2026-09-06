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
  if (ageDays === null) unknowns.push('Tuổi pool (nguồn không trả về ngày tạo)');
  if (pair.liquidityUsd === null) unknowns.push('Thanh khoản');
  if (pair.fdvUsd === null) unknowns.push('FDV');
  if (pair.marketCapUsd === null) unknowns.push('Vốn hoá lưu hành');
  if (pair.volume.h24 === null) unknowns.push('Khối lượng 24h');

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
    unknowns.push('Kiểm định an toàn (chain này chưa có nguồn screen)');
  } else {
    if (safety.topHolderPct === null) unknowns.push('Tỉ lệ ví lớn nhất');
    if (safety.lpLocked === null) unknowns.push('LP đã khoá hay chưa');
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
  'Vốn hoá và nguồn cung lưu hành — chưa nối nguồn dữ liệu nào cho phần này',
  'Lịch mở khoá token',
  'Phân bố ví nắm giữ (chỉ đọc được với token on-chain)',
];
