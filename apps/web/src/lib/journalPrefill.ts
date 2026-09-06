import { isTradeSide, type Gem, type TradeSide } from './types';

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
export function journalPrefillHref(gem: Gem): string {
  const params = new URLSearchParams({
    symbol: gem.symbol,
    side: 'spot',
    note: `${gem.chainId} · ${gem.tokenAddress} · Gem ${gem.gemScore}`,
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
  };
}
