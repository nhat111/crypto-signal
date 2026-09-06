import type { Pool } from 'pg';

/**
 * The current price of something in the journal, for pricing a position
 * that is still open.
 *
 * The journal holds two very different kinds of symbol — exchange tickers
 * the market-health side already tracks, and gem tokens named by ticker or
 * by contract address — so this resolves against both sources and says
 * which one answered. It never invents: a symbol nothing knows about comes
 * back as unknown rather than as a price, because an unrealized P&L
 * computed from a wrong price is worse than no P&L at all. The user would
 * act on it.
 */
export type MarkPriceSource = 'snapshot' | 'gem_scan';

export type MarkPriceUnknownReason =
  /** Nothing in either source names this symbol. */
  | 'not_found'
  /**
   * Two or more different tokens share this ticker. Tickers are not
   * unique across chains — this is the case where guessing would put a
   * confident, wrong number in front of somebody about to sell.
   */
  | 'ambiguous_ticker';

export interface MarkPrice {
  priceUsd: number | null;
  /** When that price was observed. Null with the price. */
  at: number | null;
  source: MarkPriceSource | null;
  /** Null exactly when a price was found. */
  unknownReason: MarkPriceUnknownReason | null;
}

const UNKNOWN = (reason: MarkPriceUnknownReason): MarkPrice => ({
  priceUsd: null,
  at: null,
  source: null,
  unknownReason: reason,
});

interface GemPriceRow {
  tokenAddress: string;
  symbol: string;
  priceUsd: number;
  at: number;
}

/**
 * Latest price for each of `symbols`, keyed by the symbol exactly as the
 * journal stores it.
 *
 * Two lookups, in priority order per symbol: an exchange snapshot (the
 * market-health side's own `price_close`), then the last gem scan. A
 * journal symbol is matched to a gem by contract address first — the only
 * unambiguous identifier — and only then by ticker.
 */
export async function getMarkPrices(pool: Pool, symbols: string[]): Promise<Map<string, MarkPrice>> {
  const result = new Map<string, MarkPrice>();
  const wanted = [...new Set(symbols.filter((s) => s.trim() !== ''))];
  if (wanted.length === 0) return result;

  const { rows: snapshotRows } = await pool.query(
    `SELECT DISTINCT ON (symbol) symbol, price_close, extract(epoch from timestamp)*1000 AS ts
     FROM market_health_snapshots
     WHERE symbol = ANY($1)
     ORDER BY symbol, timestamp DESC`,
    [wanted],
  );
  const bySnapshot = new Map<string, { priceUsd: number; at: number }>();
  for (const r of snapshotRows) {
    bySnapshot.set(String(r.symbol), { priceUsd: Number(r.price_close), at: Math.round(Number(r.ts)) });
  }

  // Only tokens that could match something in the journal, so the query
  // stays bounded by the journal rather than by how many gems were scanned.
  const lowered = wanted.map((s) => s.toLowerCase());
  const uppered = wanted.map((s) => s.toUpperCase());
  const { rows: gemRows } = await pool.query(
    `SELECT DISTINCT ON (s.chain_id, s.token_address)
            s.token_address, t.symbol, s.price_usd, extract(epoch from s.scanned_at)*1000 AS ts
     FROM gem_scans s
     JOIN gem_tokens t ON t.chain_id = s.chain_id AND t.token_address = s.token_address
     WHERE s.price_usd IS NOT NULL
       AND (lower(s.token_address) = ANY($1) OR upper(t.symbol) = ANY($2))
     ORDER BY s.chain_id, s.token_address, s.scanned_at DESC`,
    [lowered, uppered],
  );
  const gems: GemPriceRow[] = gemRows.map((r) => ({
    tokenAddress: String(r.token_address),
    symbol: String(r.symbol),
    priceUsd: Number(r.price_usd),
    at: Math.round(Number(r.ts)),
  }));

  for (const symbol of wanted) {
    const snapshot = bySnapshot.get(symbol);
    if (snapshot) {
      result.set(symbol, { ...snapshot, source: 'snapshot', unknownReason: null });
      continue;
    }
    result.set(symbol, resolveGemPrice(symbol, gems));
  }

  return result;
}

/**
 * One journal symbol against the gem rows, address first.
 *
 * Address matching is case-insensitive because an EVM address gets pasted
 * in whatever casing the explorer showed, but it still has to resolve to
 * exactly ONE token — two addresses differing only in case are different
 * strings, and picking either would be a guess.
 */
export function resolveGemPrice(symbol: string, gems: GemPriceRow[]): MarkPrice {
  const needle = symbol.toLowerCase();

  const byAddress = gems.filter((g) => g.tokenAddress.toLowerCase() === needle);
  if (byAddress.length === 1) {
    const hit = byAddress[0] as GemPriceRow;
    return { priceUsd: hit.priceUsd, at: hit.at, source: 'gem_scan', unknownReason: null };
  }
  if (byAddress.length > 1) return UNKNOWN('ambiguous_ticker');

  const byTicker = gems.filter((g) => g.symbol.toUpperCase() === symbol.toUpperCase());
  if (byTicker.length === 1) {
    const hit = byTicker[0] as GemPriceRow;
    return { priceUsd: hit.priceUsd, at: hit.at, source: 'gem_scan', unknownReason: null };
  }
  // Several tokens share this ticker. Naming the ambiguity is the point:
  // it tells the user to log the address instead, which no "no price
  // available" could.
  if (byTicker.length > 1) return UNKNOWN('ambiguous_ticker');

  return UNKNOWN('not_found');
}

/**
 * An open position priced against the current market.
 *
 * Kept apart from the stored `pnlPct`/`pnlUsd` on purpose. Those are
 * realized: computed once at close, from a price the user actually got,
 * and never recomputed. This one is an estimate that changes every time
 * anybody looks, from a price nobody transacted at. Blending the two would
 * make a win rate that moves on its own, which is the same mistake as
 * netting Health against Leverage Risk.
 */
export interface OpenPosition {
  side: 'long' | 'short' | 'spot';
  entryPrice: number;
  size: number | null;
}

export interface UnrealizedPnl {
  markPrice: number | null;
  markPriceAt: number | null;
  markPriceSource: MarkPriceSource | null;
  markPriceUnknownReason: MarkPriceUnknownReason | null;
  /** Null whenever there is no usable mark price — never 0, which reads as "flat". */
  unrealizedPnlPct: number | null;
  /** Null when the mark price is missing OR no size was recorded. */
  unrealizedPnlUsd: number | null;
}

/**
 * Prices one open position, or explains why it could not.
 *
 * A zero or negative mark is refused rather than used: a price of 0 turns
 * every long into a -100% loss on the page, which is a far more alarming
 * lie than an honest blank.
 */
export function computeUnrealized(position: OpenPosition, mark: MarkPrice): UnrealizedPnl {
  const base = {
    markPrice: mark.priceUsd,
    markPriceAt: mark.at,
    markPriceSource: mark.source,
    markPriceUnknownReason: mark.unknownReason,
  };

  if (mark.priceUsd === null || mark.priceUsd <= 0 || position.entryPrice <= 0) {
    return { ...base, unrealizedPnlPct: null, unrealizedPnlUsd: null };
  }

  const direction = position.side === 'short' ? -1 : 1;
  const pnlPct = ((mark.priceUsd - position.entryPrice) / position.entryPrice) * direction * 100;
  const pnlUsd = position.size === null ? null : (mark.priceUsd - position.entryPrice) * direction * position.size;
  return { ...base, unrealizedPnlPct: pnlPct, unrealizedPnlUsd: pnlUsd };
}
