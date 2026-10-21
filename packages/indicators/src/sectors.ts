/**
 * Which sectors (mảng) money is moving into, measured against BTC.
 *
 * A market where "only one or two sectors pump at a time" is a claim about
 * breadth and relative strength, so both are measured: the median coin's
 * 7d/30d return minus BTC's, and the share of the sector's coins that beat
 * BTC. The median rather than a market-cap weighting, so one large coin
 * cannot speak for the sector; the weighted figure is kept beside it.
 *
 * Four labels from two windows, no composite score (ASSUMPTIONS.md §26).
 * Pure: markets in, read out.
 */

export type SectorLabel = 'leading' | 'emerging' | 'fading' | 'lagging';
export const ALL_SECTOR_LABELS: readonly SectorLabel[] = ['leading', 'emerging', 'fading', 'lagging'];

export interface SectorCoinInput {
  id: string;
  symbol: string;
  name: string;
  marketCapUsd: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
}

export interface SectorLeader {
  symbol: string;
  name: string;
  change7dPct: number;
}

export interface SectorRead {
  categoryId: string;
  name: string;
  /** Coins with both returns known, after stablecoins are removed. */
  coinCount: number;
  median7dPct: number;
  median30dPct: number;
  /** Median minus BTC, in percentage points. */
  rs7d: number;
  rs30d: number;
  /** Share of the coins that beat BTC over the window, 0–100. */
  breadth7dPct: number;
  breadth30dPct: number;
  /** Market-cap weighted 7d return, for comparison with the median. */
  weighted7dPct: number | null;
  btc7dPct: number;
  btc30dPct: number;
  label: SectorLabel;
  /** Best three coins over 7 days. */
  leaders: SectorLeader[];
  reasons: string[];
}

/** Below this, a median is a couple of coins and the label would be noise. */
export const SECTOR_MIN_COINS = 5;
/**
 * Coins under this market cap are left out. A small category's "top 30"
 * reaches down into illiquid tokens, and one of them up 1,600% in a week
 * says nothing about where money in the sector is going.
 */
export const SECTOR_MIN_COIN_MCAP_USD = 10_000_000;
/**
 * A 7-day change above this is a coin listed during the week, measured
 * from its launch price (one meme read +56,000%). It is not comparable
 * with the rest and would swamp the average, so it is left out.
 */
export const SECTOR_MAX_PLAUSIBLE_7D_PCT = 1_000;
/** Under this share of coins beating BTC, a strong median is a few coins carrying the rest. */
const NARROW_BREADTH_PCT = 35;
const BROAD_BREADTH_PCT = 65;
/** How far the average must beat BTC (points) before a narrow sector is worth calling out. */
const NARROW_MEAN_GAP = 5;

/** Vietnamese names for the default categories; others fall back to CoinGecko's. */
export const SECTOR_NAMES_VI: Readonly<Record<string, string>> = {
  'layer-1': 'Layer 1',
  'layer-2': 'Layer 2',
  'artificial-intelligence': 'AI',
  'ai-agents': 'AI agent',
  'meme-token': 'Meme',
  'solana-meme-coins': 'Meme Solana',
  'decentralized-exchange': 'Sàn DEX',
  'decentralized-perpetuals': 'Perp DEX',
  'lending-borrowing': 'Lending',
  'liquid-staking-governance-tokens': 'Liquid staking',
  'real-world-assets-rwa': 'RWA',
  depin: 'DePIN',
  gaming: 'GameFi',
  'privacy-coins': 'Privacy',
  oracle: 'Oracle',
  'prediction-markets': 'Prediction market',
  'exchange-based-tokens': 'Token sàn CEX',
  launchpad: 'Launchpad',
  'zero-knowledge-zk': 'ZK',
  'hyperliquid-ecosystem': 'Hệ Hyperliquid',
};

export const SECTOR_LABEL_VI: Readonly<Record<SectorLabel, string>> = {
  leading: 'Dẫn dắt',
  emerging: 'Đang nổi',
  fading: 'Hạ nhiệt',
  lagging: 'Yếu',
};

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

/**
 * Leading: beats BTC over both windows. Emerging: the last week only, so
 * it is new. Fading: the month but not the week, so it is cooling.
 * Lagging: neither. "Beats" means the median coin did, by more than zero.
 */
export function classifySector(rs7d: number, rs30d: number): SectorLabel {
  if (rs7d > 0 && rs30d > 0) return 'leading';
  if (rs7d > 0) return 'emerging';
  if (rs30d > 0) return 'fading';
  return 'lagging';
}

function fmt(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
}

export function readSector(
  categoryId: string,
  name: string,
  coins: readonly SectorCoinInput[],
  btc: { change7dPct: number; change30dPct: number },
  /** CoinGecko ids of stablecoins: they sit in many categories and would pin every median near zero. */
  stablecoinIds: ReadonlySet<string>,
): SectorRead | null {
  const usable = coins.filter(
    (c) =>
      !stablecoinIds.has(c.id) &&
      typeof c.marketCapUsd === 'number' &&
      c.marketCapUsd >= SECTOR_MIN_COIN_MCAP_USD &&
      typeof c.change7dPct === 'number' &&
      Number.isFinite(c.change7dPct) &&
      c.change7dPct <= SECTOR_MAX_PLAUSIBLE_7D_PCT &&
      typeof c.change30dPct === 'number' &&
      Number.isFinite(c.change30dPct),
  ) as Array<SectorCoinInput & { change7dPct: number; change30dPct: number }>;
  if (usable.length < SECTOR_MIN_COINS) return null;

  const median7dPct = median(usable.map((c) => c.change7dPct));
  const median30dPct = median(usable.map((c) => c.change30dPct));
  const rs7d = median7dPct - btc.change7dPct;
  const rs30d = median30dPct - btc.change30dPct;
  const breadth7dPct = (usable.filter((c) => c.change7dPct > btc.change7dPct).length / usable.length) * 100;
  const breadth30dPct = (usable.filter((c) => c.change30dPct > btc.change30dPct).length / usable.length) * 100;

  const capSum = usable.reduce((s, c) => s + (c.marketCapUsd as number), 0);
  const weighted7dPct = capSum > 0 ? usable.reduce((s, c) => s + (c.marketCapUsd as number) * c.change7dPct, 0) / capSum : null;

  const label = classifySector(rs7d, rs30d);
  const leaders = [...usable]
    .sort((a, b) => b.change7dPct - a.change7dPct)
    .slice(0, 3)
    .map((c) => ({ symbol: c.symbol, name: c.name, change7dPct: c.change7dPct }));

  const reasons = [
    `Coin trung vị ${fmt(median7dPct)}% 7 ngày, ${fmt(median30dPct)}% 30 ngày; BTC ${fmt(btc.change7dPct)}% và ${fmt(btc.change30dPct)}%`,
    `${breadth7dPct.toFixed(0)}% số coin thắng BTC trong 7 ngày (${usable.length} coin)`,
  ];
  // The median cannot show a sector carried by a few coins (a median above
  // BTC already means half the coins beat it); the plain average can, since
  // two coins up 80% drag it up while the rest lag.
  const mean7dPct = usable.reduce((s, c) => s + c.change7dPct, 0) / usable.length;
  if (mean7dPct - btc.change7dPct >= NARROW_MEAN_GAP && breadth7dPct < NARROW_BREADTH_PCT) {
    reasons.push(`Hẹp: trung bình ${fmt(mean7dPct)}% nhưng chỉ vài coin kéo, phần lớn vẫn thua BTC`);
  } else if (breadth7dPct >= BROAD_BREADTH_PCT) {
    reasons.push('Rộng: đa số coin trong mảng cùng tăng hơn BTC');
  }
  if (weighted7dPct !== null && Math.abs(weighted7dPct - median7dPct) >= 10) {
    reasons.push(
      weighted7dPct > median7dPct
        ? `Coin lớn kéo: theo vốn hoá ${fmt(weighted7dPct)}%, cao hơn hẳn coin trung vị`
        : `Coin nhỏ chạy trước: theo vốn hoá chỉ ${fmt(weighted7dPct)}%`,
    );
  }

  return {
    categoryId,
    name,
    coinCount: usable.length,
    median7dPct,
    median30dPct,
    rs7d,
    rs30d,
    breadth7dPct,
    breadth30dPct,
    weighted7dPct,
    btc7dPct: btc.change7dPct,
    btc30dPct: btc.change30dPct,
    label,
    leaders,
    reasons,
  };
}
