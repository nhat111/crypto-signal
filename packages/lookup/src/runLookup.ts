import type { Logger } from '@crypto-signal/shared';
import type { OhlcvBar } from '@crypto-signal/indicators';
import type { GemPair, SafetyReport } from '@crypto-signal/gem-scanner';
import { buildOnChainFundamentals, EXCHANGE_FUNDAMENTAL_GAPS, type ExchangeFundamentals, type OnChainFundamentals } from './fundamentalRead.js';
import { candidateSymbols, resolveQuery } from './resolveQuery.js';
import { buildTechnicalRead, type TechnicalRead } from './technicalRead.js';

/**
 * One lookup, either kind, assembled from injected sources.
 *
 * Sources are injected rather than constructed here for the same reason
 * runScan does it: the decisions worth testing — which symbol was tried,
 * which pair was picked out of several, what happens when nothing is found
 * — are the ones a network makes untestable.
 */
export interface LookupDeps {
  /** Closed bars for an exchange symbol, newest last. Empty when the symbol is not listed. */
  fetchBars(symbol: string, timeframe: string, limit: number): Promise<OhlcvBar[]>;
  /** Pairs matching a contract address, across chains. */
  searchPairs(query: string): Promise<GemPair[]>;
  /** Null when no screen covers the chain — never treated as a pass. */
  screen(chainId: string, tokenAddress: string): Promise<SafetyReport | null>;
  logger: Logger;
}

export interface ExchangeLookup {
  kind: 'exchange';
  /** What was actually found on the exchange, which may differ from what was typed. */
  symbol: string;
  timeframe: string;
  technical: TechnicalRead;
  fundamentals: ExchangeFundamentals;
  /** Symbols tried before this one matched, so a surprising result is explainable. */
  triedSymbols: string[];
}

export interface OnChainLookup {
  kind: 'onchain';
  fundamentals: OnChainFundamentals;
  /** Null: DexScreener's free API returns no candle history, so there is no chart to read. */
  technical: null;
  /** Other pools for the same token, when the address trades on more than one. */
  otherPools: Array<{ chainId: string; dexId: string; liquidityUsd: number | null }>;
}

export interface LookupFailure {
  kind: 'not_found';
  reason: string;
}

export type LookupResult = ExchangeLookup | OnChainLookup | LookupFailure;

/** Enough for EMA50 with room to spare, and one Binance request. */
export const DEFAULT_BAR_LIMIT = 200;

export async function runLookup(
  deps: LookupDeps,
  raw: string,
  opts: { timeframe?: string; now?: number } = {},
): Promise<LookupResult> {
  const query = resolveQuery(raw);
  if (query.kind === 'invalid') return { kind: 'not_found', reason: query.reason };

  if (query.kind === 'address') return lookupAddress(deps, query.address, opts.now ?? Date.now());
  return lookupExchange(deps, query.symbol, opts.timeframe ?? '4h');
}

async function lookupExchange(deps: LookupDeps, symbol: string, timeframe: string): Promise<LookupResult> {
  const candidates = candidateSymbols(symbol);
  const tried: string[] = [];

  for (const candidate of candidates) {
    tried.push(candidate);
    let bars: OhlcvBar[] = [];
    try {
      bars = await deps.fetchBars(candidate, timeframe, DEFAULT_BAR_LIMIT);
    } catch (err) {
      // An unlisted symbol is a 400 from Binance, which is indistinguishable
      // here from a transient failure — so try the next quote asset rather
      // than declaring the token unlisted on one bad response.
      deps.logger.warn({ err, candidate }, 'lookup: kline fetch failed, trying the next quote');
      continue;
    }
    if (bars.length === 0) continue;

    const technical = buildTechnicalRead(bars);
    if (technical === null) continue;

    return {
      kind: 'exchange',
      symbol: candidate,
      timeframe,
      technical,
      fundamentals: {
        symbol: candidate,
        spotListed: true,
        futuresListed: false,
        quoteVolume24hUsd: null,
        fundingRate: null,
        openInterest: null,
        unknowns: [...EXCHANGE_FUNDAMENTAL_GAPS],
      },
      triedSymbols: tried,
    };
  }

  return {
    kind: 'not_found',
    reason: `Không tìm thấy "${symbol}" trên Binance (đã thử ${tried.join(', ')}). Nếu là token on-chain, dán địa chỉ contract.`,
  };
}

async function lookupAddress(deps: LookupDeps, address: string, now: number): Promise<LookupResult> {
  let pairs: GemPair[] = [];
  try {
    pairs = await deps.searchPairs(address);
  } catch (err) {
    deps.logger.warn({ err, address }, 'lookup: pair search failed');
    return { kind: 'not_found', reason: 'Không tra được địa chỉ này lúc này — nguồn dữ liệu DEX đang không phản hồi.' };
  }

  // The search matches on more than the base token, so a pair where this
  // address is the QUOTE side (a token paired against it) is not the token
  // that was asked about.
  const matching = pairs.filter((p) => p.baseToken.address.toLowerCase() === address.toLowerCase());
  if (matching.length === 0) {
    return {
      kind: 'not_found',
      reason: 'Không có pool nào cho địa chỉ này trên các DEX mà nguồn dữ liệu phủ. Kiểm tra lại địa chỉ và chain.',
    };
  }

  // Deepest pool wins: it is the price a buyer would actually get, the
  // same rule the scanner uses.
  const sorted = [...matching].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  const best = sorted[0] as GemPair;

  const safety = await deps
    .screen(best.chainId, best.baseToken.address)
    .catch((err) => {
      deps.logger.warn({ err, address }, 'lookup: safety screen failed');
      return null;
    });

  return {
    kind: 'onchain',
    fundamentals: buildOnChainFundamentals(best, safety, now),
    technical: null,
    otherPools: sorted.slice(1, 6).map((p) => ({ chainId: p.chainId, dexId: p.dexId, liquidityUsd: p.liquidityUsd })),
  };
}
