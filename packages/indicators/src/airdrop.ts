/**
 * Airdrop research list: protocols that hold real deposits but have no
 * token yet.
 *
 * That is the one shape every past retroactive airdrop shared — users were
 * paid for having used something before it had a token — so it is the
 * screen. It is not a prediction: plenty of tokenless protocols never
 * launch one, some launch one and give users nothing, and DefiLlama can
 * lag a fresh token launch by days. Every candidate carries its reasons
 * and what is still unknown, and there is no single score (ASSUMPTIONS.md
 * §25), same rule as the rest of the project.
 *
 * Pure: protocols and stored history in, candidates out.
 */

/** The fields of a DefiLlama `/protocols` row this screen reads. */
export interface AirdropProtocolInput {
  name: string;
  slug: string;
  symbol?: string | null;
  gecko_id?: string | null;
  cmcId?: string | number | null;
  category?: string | null;
  chains?: string[] | null;
  tvl?: number | null;
  change_1d?: number | null;
  change_7d?: number | null;
  url?: string | null;
  twitter?: string | null;
  logo?: string | null;
  audits?: string | number | null;
  listedAt?: number | null;
  parentProtocolSlug?: string | null;
  deprecated?: boolean | null;
  rugged?: boolean | null;
  deadUrl?: boolean | null;
  /** Stablecoins this protocol issues. An issuer already has its token: the stablecoin. */
  stablecoins?: string[] | null;
}

export interface AirdropThresholds {
  /** Below this the protocol is too small for its users to be worth an airdrop, or too small to farm safely. */
  minTvlUsd: number;
  /** Cap on stored candidates per day, largest TVL first. */
  maxCandidates: number;
}

export interface AirdropCandidate {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvlUsd: number;
  change1dPct: number | null;
  change7dPct: number | null;
  /** From our own stored history; null until ~30 days of it exist. */
  change30dPct: number | null;
  url: string | null;
  twitter: string | null;
  logo: string | null;
  listedAtMs: number | null;
  audits: number | null;
  parentSlug: string | null;
  /** Why it is on the list, in Vietnamese. */
  reasons: string[];
  /** What the data cannot tell, or what argues against it, in Vietnamese. */
  unknowns: string[];
}

/**
 * Categories whose "protocols" are custodians, curators or chains rather
 * than apps a user farms: a CEX wallet, a wrapped-BTC custodian, a vault
 * curator working inside someone else's protocol, a tokenized fund.
 * Tokenless, often huge, and never an airdrop.
 */
export const AIRDROP_EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'CEX',
  'Chain',
  'Canonical Bridge',
  'Risk Curators',
  'Onchain Capital Allocator',
  'Stablecoin Wrapper',
  'Anchor BTC',
  'Crypto Card Issuer',
  'CeDeFi',
  'Payments',
  'Treasury Manager',
  'RWA',
]);

/**
 * Products run by an exchange or a custodian ("Binance staked ETH",
 * "Coinbase Bridge", "WBTC") sit in ordinary categories, so the category
 * screen misses them. They never airdrop: the company already has, or
 * never needs, a token.
 */
const CUSTODIAL_NAME = /\b(binance|coinbase|kraken|okx|bybit|bitget|kucoin|htx|huobi|gate|mexc|upbit|bithumb|robinhood|crypto\.com)\b|wbtc|wrapped/i;

const GROWTH_7D_PCT = 10;
const GROWTH_30D_PCT = 25;
const DECLINE_7D_PCT = -20;
const NEW_LISTING_DAYS = 180;
const MULTI_CHAIN = 3;
const DAY_MS = 86_400_000;

export function hasToken(p: AirdropProtocolInput): boolean {
  const symbol = p.symbol?.trim() ?? '';
  return (symbol !== '' && symbol !== '-') || Boolean(p.gecko_id) || (p.cmcId !== null && p.cmcId !== undefined && p.cmcId !== '');
}

/**
 * Parents with a token, read off their children: DefiLlama lists "Aave V3"
 * with Aave's symbol, but a newer child of the same parent can come
 * through tokenless. Using it already earns the parent's existing token,
 * not a new airdrop.
 */
export function tokenizedParents(protocols: readonly AirdropProtocolInput[]): Set<string> {
  const parents = new Set<string>();
  for (const p of protocols) {
    if (p.parentProtocolSlug && hasToken(p)) parents.add(p.parentProtocolSlug);
  }
  return parents;
}

export function screenAirdropCandidates(
  protocols: readonly AirdropProtocolInput[],
  thresholds: AirdropThresholds,
  /** slug → TVL about 30 days ago, from stored candidate rows. */
  tvl30dAgo: ReadonlyMap<string, number>,
  nowMs: number,
): AirdropCandidate[] {
  const parents = tokenizedParents(protocols);

  return protocols
    .filter((p) => {
      const tvl = p.tvl ?? 0;
      if (!Number.isFinite(tvl) || tvl < thresholds.minTvlUsd) return false;
      if (hasToken(p)) return false;
      if (p.deprecated || p.rugged || p.deadUrl) return false;
      if (p.stablecoins && p.stablecoins.length > 0) return false;
      if (p.category && AIRDROP_EXCLUDED_CATEGORIES.has(p.category)) return false;
      if (CUSTODIAL_NAME.test(p.name)) return false;
      if (p.parentProtocolSlug && parents.has(p.parentProtocolSlug)) return false;
      return true;
    })
    .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
    .slice(0, Math.max(0, thresholds.maxCandidates))
    .map((p) => toCandidate(p, tvl30dAgo.get(p.slug) ?? null, nowMs));
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function auditCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toCandidate(p: AirdropProtocolInput, tvlThen: number | null, nowMs: number): AirdropCandidate {
  const tvlUsd = p.tvl ?? 0;
  const change7dPct = finiteOrNull(p.change_7d);
  const change30dPct = tvlThen !== null && tvlThen > 0 ? ((tvlUsd - tvlThen) / tvlThen) * 100 : null;
  // DefiLlama's listedAt is unix seconds.
  const listedAtMs = finiteOrNull(p.listedAt) === null ? null : (p.listedAt as number) * 1000;
  const audits = auditCount(p.audits);
  const chains = p.chains ?? [];

  const candidate: AirdropCandidate = {
    slug: p.slug,
    name: p.name,
    category: p.category ?? null,
    chains,
    tvlUsd,
    change1dPct: finiteOrNull(p.change_1d),
    change7dPct,
    change30dPct,
    url: p.url || null,
    twitter: p.twitter || null,
    logo: p.logo || null,
    listedAtMs,
    audits,
    parentSlug: p.parentProtocolSlug ?? null,
    reasons: [],
    unknowns: [],
  };
  candidate.reasons = airdropReasons(candidate, nowMs);
  candidate.unknowns = airdropUnknowns(candidate);
  return candidate;
}

export function formatUsdShort(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function airdropReasons(c: AirdropCandidate, nowMs: number): string[] {
  const reasons = [`Chưa có token, đang giữ ${formatUsdShort(c.tvlUsd)} TVL`];
  if (c.change7dPct !== null && c.change7dPct >= GROWTH_7D_PCT) {
    reasons.push(`TVL +${c.change7dPct.toFixed(0)}% trong 7 ngày: tiền đang chảy vào`);
  }
  if (c.change30dPct !== null && c.change30dPct >= GROWTH_30D_PCT) {
    reasons.push(`TVL +${c.change30dPct.toFixed(0)}% trong 30 ngày`);
  }
  if (c.listedAtMs !== null) {
    const days = Math.floor((nowMs - c.listedAtMs) / DAY_MS);
    if (days >= 0 && days <= NEW_LISTING_DAYS) reasons.push(`Mới lên DefiLlama ${days} ngày: còn sớm`);
  }
  if (c.chains.length >= MULTI_CHAIN) reasons.push(`Chạy trên ${c.chains.length} chain`);
  if (c.audits !== null && c.audits > 0) reasons.push('Có audit');
  return reasons;
}

export function airdropUnknowns(c: AirdropCandidate): string[] {
  // "DefiLlama can lag a token launch" applies to every row, so it is said
  // once on the page and in the bot reply, not repeated on each card.
  const unknowns: string[] = [];
  if (c.change7dPct !== null && c.change7dPct <= DECLINE_7D_PCT) {
    unknowns.push(`TVL ${c.change7dPct.toFixed(0)}% trong 7 ngày: tiền đang rút ra`);
  }
  if (c.audits === null || c.audits === 0) unknowns.push('Không thấy audit trên DefiLlama');
  if (!c.twitter) unknowns.push('Không có X/Twitter: khó theo dõi thông báo points/snapshot');
  if (c.change30dPct === null) unknowns.push('Chưa đủ 30 ngày lịch sử để tính TVL 30 ngày');
  return unknowns;
}
