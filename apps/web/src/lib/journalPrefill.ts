import { isTradeSide, type Gem, type TradeSetup, type TradeSide } from './types';

/**
 * The hand-off from a gem card to the journal form, both directions.
 *
 * Writer and reader live together on purpose: they agree through four
 * query-string keys, and a rename on one side alone would produce a link
 * that still navigates, still renders a journal page, and silently fills
 * in nothing. The round-trip test below is the only thing that catches
 * that, and it can only exist if both halves are here.
 */
export interface TradePrefill {
  symbol: string;
  side: TradeSide;
  /** A string, not a number: it goes straight into a text input the user edits. */
  entryPrice: string;
  note: string;
  /** Where the idea came from; a gem card fills in the scanner, so its picks are scored as a source. */
  source: string;
  /** Why — a setup card fills in its plan, so a loss is read back against it. Empty for a gem. */
  thesis: string;
}

/**
 * A journal draft for this token — never a logged trade.
 *
 * The symbol is the ticker, because that is what a person recognises in
 * the table and types into /close, and the address goes in the note
 * because a ticker does not identify a token: several tokens share one.
 * The price is the last SCAN's price, which is exactly why this fills a
 * form rather than writing a row — what the user actually paid is theirs
 * to enter, and a journal that quietly recorded the scanner's price would
 * be recording something that never happened.
 */
/**
 * Trades opened from a gem card are credited to the scanner, so the
 * journal's by-source table answers "did buying what it surfaced pay?"
 * with the user's own fills, not the scanner's paper outcomes.
 */
export const GEM_SCANNER_SOURCE = 'Gem scanner';

/** Trades opened from a 4H setup card are credited to it, for the same reason. */
export const SETUP_SCANNER_SOURCE = 'Setup scanner';

const SETUP_KIND_LABEL: Record<TradeSetup['kind'], string> = { pullback: 'hồi về hỗ trợ', breakout_retest: 'phá vùng rồi test lại' };

/**
 * A journal draft for a 4H setup. The price is the setup's planned entry —
 * a plan, not a fill — so like the gem draft it fills the form and leaves
 * the number for the user to correct to what they actually paid.
 */
export function setupPrefillHref(setup: TradeSetup): string {
  const params = new URLSearchParams({
    symbol: setup.symbol,
    side: 'spot',
    entry: String(setup.entry),
    source: SETUP_SCANNER_SOURCE,
    thesis: `4H ${SETUP_KIND_LABEL[setup.kind]} ${setup.level} · SL ${setup.stop.toPrecision(6)} · TP ${setup.target} · R:R 1:${setup.rr.toFixed(1)}`,
  });
  return `/journal?${params.toString()}`;
}

export function journalPrefillHref(gem: Gem): string {
  const params = new URLSearchParams({
    symbol: gem.symbol,
    side: 'spot',
    note: `${gem.chainId} · ${gem.tokenAddress} · Gem ${gem.gemScore}`,
    source: GEM_SCANNER_SOURCE,
  });
  if (gem.priceUsd !== null) params.set('entry', String(gem.priceUsd));
  return `/journal?${params.toString()}`;
}

/**
 * Reads a draft back out of a URL, where anything at all can be typed.
 *
 * A missing or nonsense side falls back to spot rather than rejecting the
 * whole draft: the user still gets the symbol and price filled in, and the
 * side is one tap to correct. A missing symbol is different — there is no
 * draft at all then, and pre-filling an empty form would just be a form.
 */
export function parseTradePrefill(params: URLSearchParams): TradePrefill | null {
  const symbol = params.get('symbol');
  if (symbol === null || symbol.trim() === '') return null;

  const side = params.get('side');
  const entry = params.get('entry');

  return {
    symbol,
    side: isTradeSide(side) ? side : 'spot',
    // A gem with no last-scan price still opens the form; the price box is
    // simply left for the user, which is where it belonged anyway.
    entryPrice: entry !== null && entry.trim() !== '' && Number.isFinite(Number(entry)) ? entry : '',
    note: params.get('note') ?? '',
    source: params.get('source') ?? '',
    thesis: params.get('thesis') ?? '',
  };
}
