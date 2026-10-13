/**
 * The "why would this coin go up" half of the coin scan, from DefiLlama.
 *
 * A token has no earnings. What it can have, measurably, is a chain or a
 * protocol people use: fees paid to it, money parked in it (TVL), and — for
 * a chain — stablecoins arriving on it. Each of those is read as a change
 * against its own recent past, and a change only counts once it is big
 * enough and the base it is measured on is not trivial (a chain with $2M
 * TVL doubling is noise).
 *
 * Pure: DefiLlama's lists in, drivers out. No score. A coin with no match
 * says so; the drivers never pretend to cover what they do not.
 *
 * Token unlocks are not here: every unlock source checked (DefiLlama's
 * emissions API, Tokenomist) is paid. That is stated, not guessed around.
 */

export interface LlamaChain {
  name: string;
  tokenSymbol: string | null;
  tvl: number;
}

export interface LlamaProtocol {
  name: string;
  symbol: string | null;
  parentProtocol: string | null;
  /** DefiLlama's category; "CEX" rows are exchanges' reserves, not a protocol the token belongs to. */
  category?: string | null;
  tvl: number | null;
  /** Percent. */
  change7d: number | null;
}

export interface LlamaFees {
  name: string;
  category: string | null;
  parentProtocol: string | null;
  total30d: number | null;
  total60dto30d: number | null;
}

export interface DayValue {
  /** Unix seconds, as DefiLlama sends it. */
  date: number;
  value: number;
}

export interface FundamentalThresholds {
  /** 30-day fees against the 30 days before, percent. */
  feesChangePct: number;
  /** TVL change (7d for a protocol, 30d for a chain), percent. */
  tvlChangePct: number;
  /** Stablecoins on the chain over 30 days, percent. */
  stablecoinChangePct: number;
  /** Below this a TVL or stablecoin base is too small for its change to mean anything. */
  minTvlUsd: number;
  /** Below this, 30 days of fees are too small to compare. */
  minFees30dUsd: number;
}

export const FUNDAMENTAL_THRESHOLDS: FundamentalThresholds = {
  feesChangePct: 20,
  tvlChangePct: 10,
  stablecoinChangePct: 5,
  minTvlUsd: 50_000_000,
  minFees30dUsd: 100_000,
};

export interface ChainFundamentals {
  name: string;
  tvlUsd: number;
  tvlChange30dPct: number | null;
  stablecoinsUsd: number | null;
  stablecoinsChange30dPct: number | null;
  fees30dUsd: number | null;
  feesChangePct: number | null;
}

export interface ProtocolFundamentals {
  /** DefiLlama's parent slug ("uniswap") or, for a protocol without one, its name. */
  name: string;
  tvlUsd: number | null;
  tvlChange7dPct: number | null;
  fees30dUsd: number | null;
  feesChangePct: number | null;
}

export interface CoinFundamentals {
  chain: ChainFundamentals | null;
  protocol: ProtocolFundamentals | null;
  bull: string[];
  bear: string[];
  unknowns: string[];
}

const pctChange = (now: number, before: number): number | null => (before > 0 ? (now / before - 1) * 100 : null);
const usd = (n: number): string =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}K`;
const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;

/** The chain whose gas token this is, the biggest by TVL if several claim it. */
export function matchChain(base: string, chains: LlamaChain[]): LlamaChain | null {
  const hits = chains.filter((c) => c.tokenSymbol?.toUpperCase() === base.toUpperCase());
  return hits.sort((a, b) => b.tvl - a.tvl)[0] ?? null;
}

/**
 * The protocol family whose token this is. DefiLlama lists each version of
 * a protocol separately (Uniswap V2/V3/V4) under one parent, so the family
 * is the unit: TVL and fees are summed across it. When several families
 * share a ticker (PUMP: pump.fun and an unrelated PumpBTC), the one with
 * the most fees, then the most TVL, wins — and a family too small on both
 * counts is not a match at all, so a stray ticker cannot become a thesis.
 */
export function matchProtocol(base: string, protocols: LlamaProtocol[], fees: LlamaFees[], t: FundamentalThresholds): ProtocolFundamentals | null {
  const families = new Map<string, LlamaProtocol[]>();
  for (const p of protocols) {
    if (p.symbol?.toUpperCase() !== base.toUpperCase() || p.category === 'CEX') continue;
    const key = p.parentProtocol ?? p.name;
    if (!families.has(key)) families.set(key, []);
    (families.get(key) as LlamaProtocol[]).push(p);
  }

  const read = [...families.entries()].map(([key, members]) => {
    const tvl = members.reduce((s, p) => s + (p.tvl ?? 0), 0);
    // TVL a week ago, member by member, so one version's change is weighted by its size.
    const before = members.reduce((s, p) => s + (p.tvl && p.change7d !== null ? p.tvl / (1 + p.change7d / 100) : p.tvl ?? 0), 0);
    const names = new Set(members.map((m) => m.name));
    // A chain's own fee row can share a protocol's name ("Solana"); it is
    // read as the chain's, never counted again as a protocol's.
    const feeRows = fees.filter((f) => f.category !== 'Chain' && (f.parentProtocol !== null ? f.parentProtocol === key : names.has(f.name)));
    const fees30 = feeRows.reduce((s, f) => s + (f.total30d ?? 0), 0);
    const feesPrev = feeRows.reduce((s, f) => s + (f.total60dto30d ?? 0), 0);
    return {
      name: key.replace(/^parent#/, ''),
      tvlUsd: tvl > 0 ? tvl : null,
      tvlChange7dPct: tvl > 0 ? pctChange(tvl, before) : null,
      fees30dUsd: feeRows.length > 0 ? fees30 : null,
      feesChangePct: feeRows.length > 0 && feesPrev >= t.minFees30dUsd ? pctChange(fees30, feesPrev) : null,
    };
  });

  const big = read.filter((r) => (r.fees30dUsd ?? 0) >= t.minFees30dUsd || (r.tvlUsd ?? 0) >= t.minTvlUsd);
  return big.sort((a, b) => (b.fees30dUsd ?? 0) - (a.fees30dUsd ?? 0) || (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0] ?? null;
}

/** Value 30 days before the last point, from a daily series; null without that much history. */
function change30d(series: DayValue[]): { last: number; changePct: number | null } | null {
  if (series.length === 0) return null;
  const sorted = [...series].sort((a, b) => a.date - b.date);
  const last = sorted[sorted.length - 1] as DayValue;
  const target = last.date - 30 * 86_400;
  const then = [...sorted].reverse().find((p) => p.date <= target);
  return { last: last.value, changePct: then ? pctChange(last.value, then.value) : null };
}

export interface FundamentalsInput {
  base: string;
  chains: LlamaChain[];
  protocols: LlamaProtocol[];
  fees: LlamaFees[];
  /** The matched chain's daily TVL, when it was fetched. */
  chainTvl?: DayValue[] | null;
  /** The matched chain's daily stablecoin supply, when it was fetched. */
  chainStablecoins?: DayValue[] | null;
  thresholds?: FundamentalThresholds;
}

export function readFundamentals(input: FundamentalsInput): CoinFundamentals {
  const t = input.thresholds ?? FUNDAMENTAL_THRESHOLDS;
  const bull: string[] = [];
  const bear: string[] = [];
  const unknowns: string[] = [];

  const matched = matchChain(input.base, input.chains);
  let chain: ChainFundamentals | null = null;
  if (matched) {
    const tvl = input.chainTvl ? change30d(input.chainTvl) : null;
    const stables = input.chainStablecoins ? change30d(input.chainStablecoins) : null;
    const feeRow = input.fees.find((f) => f.category === 'Chain' && f.name.toLowerCase() === matched.name.toLowerCase());
    const fees30 = feeRow?.total30d ?? null;
    const feesPrev = feeRow?.total60dto30d ?? null;
    chain = {
      name: matched.name,
      tvlUsd: tvl?.last ?? matched.tvl,
      tvlChange30dPct: tvl?.changePct ?? null,
      stablecoinsUsd: stables?.last ?? null,
      stablecoinsChange30dPct: stables?.changePct ?? null,
      fees30dUsd: fees30,
      feesChangePct: fees30 !== null && feesPrev !== null && feesPrev >= t.minFees30dUsd ? pctChange(fees30, feesPrev) : null,
    };

    const where = `chain ${chain.name}`;
    driver(chain.feesChangePct, t.feesChangePct, `Phí trên ${where} 30N ${chain.feesChangePct === null ? '' : signed(chain.feesChangePct)} so với 30N trước (${usd(chain.fees30dUsd ?? 0)}).`);
    if (chain.tvlUsd >= t.minTvlUsd) driver(chain.tvlChange30dPct, t.tvlChangePct, `TVL trên ${where} 30N ${chain.tvlChange30dPct === null ? '' : signed(chain.tvlChange30dPct)} (${usd(chain.tvlUsd)}).`);
    if ((chain.stablecoinsUsd ?? 0) >= t.minTvlUsd) {
      driver(chain.stablecoinsChange30dPct, t.stablecoinChangePct, `Stablecoin trên ${where} 30N ${chain.stablecoinsChange30dPct === null ? '' : signed(chain.stablecoinsChange30dPct)} (${usd(chain.stablecoinsUsd ?? 0)}).`);
    }
    if (input.chainTvl === null || input.chainTvl === undefined) unknowns.push(`Không đọc được lịch sử TVL của ${where}.`);
  }

  // A chain token's ticker is often reused by something on the side — a
  // foundation, a bridge, an exchange campaign (BNB → "Binance Alpha").
  // When the coin already matched a chain, a protocol is only its thesis
  // too if it earns more than the chain does (HYPE: the exchange, not L1 gas).
  const candidate = matchProtocol(input.base, input.protocols, input.fees, t);
  const protocol = candidate && (!chain || (candidate.fees30dUsd ?? 0) > (chain.fees30dUsd ?? 0)) ? candidate : null;
  if (protocol) {
    const where = `protocol ${protocol.name}`;
    driver(protocol.feesChangePct, t.feesChangePct, `Phí của ${where} 30N ${protocol.feesChangePct === null ? '' : signed(protocol.feesChangePct)} so với 30N trước (${usd(protocol.fees30dUsd ?? 0)}).`);
    if ((protocol.tvlUsd ?? 0) >= t.minTvlUsd) {
      driver(protocol.tvlChange7dPct, t.tvlChangePct, `TVL của ${where} 7N ${protocol.tvlChange7dPct === null ? '' : signed(protocol.tvlChange7dPct)} (${usd(protocol.tvlUsd ?? 0)}).`);
    }
  }

  if (!chain && !protocol) unknowns.push('Không khớp được với chain hay protocol nào trên DefiLlama — không có số liệu sử dụng thực.');

  return { chain, protocol, bull, bear, unknowns };

  function driver(change: number | null, threshold: number, text: string): void {
    if (change === null) return;
    if (change >= threshold) bull.push(text);
    else if (change <= -threshold) bear.push(text);
  }
}
