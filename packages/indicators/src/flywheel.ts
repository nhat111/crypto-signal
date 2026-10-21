/**
 * Flywheel: protocols and chains whose own revenue flows back to their
 * token holders (buybacks, burns, fee sharing), sized against the token's
 * market cap.
 *
 * The point is the loop: usage → revenue → buy pressure on the token. The
 * read gives the 30-day amount, how it moved against the 30 days before,
 * and what it is per year as a share of today's market cap, and leaves
 * the judgement to the reader: no score (ASSUMPTIONS.md §26).
 *
 * Pure: DefiLlama rows, a token directory and CoinGecko prices in, rows out.
 */

export interface FlywheelFeeInput {
  name: string;
  defillamaId: string | null;
  category: string | null;
  isChain: boolean;
  parentProtocol: string | null;
  total30d: number | null;
  total60dto30d: number | null;
  mechanism: string | null;
}

export interface FlywheelTokenRef {
  name: string;
  symbol: string | null;
  geckoId: string | null;
  mcapUsd: number | null;
}

export interface FlywheelDirectory {
  protocols: ReadonlyMap<string, FlywheelTokenRef>;
  parents: ReadonlyMap<string, FlywheelTokenRef>;
  chains: ReadonlyMap<string, FlywheelTokenRef>;
}

export interface FlywheelMarket {
  marketCapUsd: number | null;
  change30dPct: number | null;
}

export interface FlywheelThresholds {
  /** Below this a 30-day payout is too small to move a token. */
  minHoldersRevenue30dUsd: number;
  maxRows: number;
}

export interface FlywheelRow {
  /** The parent ("parent#hyperliquid"), or the row's own id when it has none. */
  familyKey: string;
  name: string;
  symbol: string | null;
  geckoId: string | null;
  category: string | null;
  holdersRevenue30dUsd: number;
  holdersRevenuePrev30dUsd: number | null;
  /** 30 days against the 30 before; null when there was nothing before. */
  holdersRevenueChangePct: number | null;
  annualizedUsd: number;
  marketCapUsd: number | null;
  /** Annualized payout as a share of market cap. Like a dividend yield, at today's price. */
  yieldPct: number | null;
  priceChange30dPct: number | null;
  mechanism: string | null;
  /** Products in the family that paid out, largest first. */
  sources: string[];
  reasons: string[];
  unknowns: string[];
}

const GROWTH_PCT = 20;
const DECLINE_PCT = -20;
const PRICE_DROP_PCT = -10;
/** Above this a "yield" is usually a one-off payout or a tiny cap, not a run rate. */
const IMPLAUSIBLE_YIELD_PCT = 50;

interface Family {
  key: string;
  rows: FlywheelFeeInput[];
}

function familyKey(row: FlywheelFeeInput): string | null {
  return row.parentProtocol ?? row.defillamaId ?? null;
}

function tokenFor(family: Family, dir: FlywheelDirectory): FlywheelTokenRef | null {
  const first = family.rows[0] as FlywheelFeeInput;
  if (first.parentProtocol) return dir.parents.get(first.parentProtocol) ?? null;
  if (first.isChain) return dir.chains.get(first.name) ?? null;
  return first.defillamaId ? (dir.protocols.get(first.defillamaId) ?? null) : null;
}

export function usdShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
}

export function readFlywheels(
  fees: readonly FlywheelFeeInput[],
  dir: FlywheelDirectory,
  /** By CoinGecko id. */
  markets: ReadonlyMap<string, FlywheelMarket>,
  thresholds: FlywheelThresholds,
): FlywheelRow[] {
  const families = new Map<string, Family>();
  for (const row of fees) {
    const key = familyKey(row);
    if (!key || row.total30d === null || row.total30d <= 0) continue;
    const family = families.get(key) ?? { key, rows: [] };
    family.rows.push(row);
    families.set(key, family);
  }

  const out: FlywheelRow[] = [];
  for (const family of families.values()) {
    family.rows.sort((a, b) => (b.total30d ?? 0) - (a.total30d ?? 0));
    const total30d = family.rows.reduce((s, r) => s + (r.total30d ?? 0), 0);
    if (total30d < thresholds.minHoldersRevenue30dUsd) continue;

    const token = tokenFor(family, dir);
    // A payout with no token behind it (a points program, a private
    // company) is not a flywheel anyone can hold.
    if (!token || (!token.symbol && !token.geckoId)) continue;

    const prevKnown = family.rows.filter((r) => r.total60dto30d !== null);
    const prev = prevKnown.length > 0 ? prevKnown.reduce((s, r) => s + (r.total60dto30d ?? 0), 0) : null;
    const market = token.geckoId ? markets.get(token.geckoId) : undefined;
    const marketCapUsd = market?.marketCapUsd ?? token.mcapUsd ?? null;
    const annualizedUsd = (total30d * 365) / 30;
    const first = family.rows[0] as FlywheelFeeInput;

    const row: FlywheelRow = {
      familyKey: family.key,
      name: first.parentProtocol ? token.name : first.name,
      symbol: token.symbol,
      geckoId: token.geckoId,
      category: first.isChain ? 'Chain' : first.category,
      holdersRevenue30dUsd: total30d,
      holdersRevenuePrev30dUsd: prev,
      holdersRevenueChangePct: prev !== null && prev > 0 ? ((total30d - prev) / prev) * 100 : null,
      annualizedUsd,
      marketCapUsd: marketCapUsd !== null && marketCapUsd > 0 ? marketCapUsd : null,
      yieldPct: marketCapUsd !== null && marketCapUsd > 0 ? (annualizedUsd / marketCapUsd) * 100 : null,
      priceChange30dPct: market?.change30dPct ?? null,
      mechanism: family.rows.find((r) => r.mechanism)?.mechanism ?? null,
      sources: family.rows.map((r) => r.name),
      reasons: [],
      unknowns: [],
    };
    explain(row);
    out.push(row);
  }

  return out.sort((a, b) => b.holdersRevenue30dUsd - a.holdersRevenue30dUsd).slice(0, Math.max(0, thresholds.maxRows));
}

function explain(row: FlywheelRow): void {
  row.reasons.push(`Trả ${usdShort(row.holdersRevenue30dUsd)} cho holder trong 30 ngày (buyback, burn hoặc chia phí)`);
  if (row.yieldPct !== null) {
    row.reasons.push(`Tương đương ${row.yieldPct.toFixed(1)}%/năm vốn hoá ${usdShort(row.marketCapUsd as number)} theo giá hiện tại`);
  }
  const change = row.holdersRevenueChangePct;
  if (change !== null && change >= GROWTH_PCT) row.reasons.push(`Tăng ${pct(change)} so với 30 ngày trước`);
  if (change !== null && change >= GROWTH_PCT && row.priceChange30dPct !== null && row.priceChange30dPct <= PRICE_DROP_PCT) {
    row.reasons.push(`Lệch pha: dòng tiền về holder tăng nhưng giá ${pct(row.priceChange30dPct)} 30 ngày`);
  }

  if (change !== null && change <= DECLINE_PCT) row.unknowns.push(`Giảm ${pct(change)} so với 30 ngày trước`);
  if (row.holdersRevenuePrev30dUsd === null || row.holdersRevenuePrev30dUsd === 0) row.unknowns.push('Không có số liệu 30 ngày trước để so');
  if (row.marketCapUsd === null) row.unknowns.push('Không có vốn hoá: không tính được tỉ lệ trên vốn hoá');
  if (row.yieldPct !== null && row.yieldPct > IMPLAUSIBLE_YIELD_PCT) {
    row.unknowns.push('Tỉ lệ trên 50%/năm: thường là khoản trả một lần hoặc vốn hoá lưu hành rất nhỏ, kiểm tra lại');
  }
}
