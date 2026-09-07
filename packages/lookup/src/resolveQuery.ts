/**
 * What the user typed, and therefore which analysis can answer it.
 *
 * The two worlds are genuinely different data, not two views of one thing.
 * An exchange ticker has candles, order flow and a funding rate; a
 * contract address has a liquidity pool, a holder distribution and a
 * contract that may or may not let you sell. Deciding wrongly does not
 * degrade the answer, it produces the wrong kind of answer entirely — so
 * the split is by SHAPE, which is unambiguous, rather than by lookup order.
 */
export type LookupQuery =
  | { kind: 'exchange'; symbol: string; raw: string }
  | { kind: 'address'; address: string; family: 'evm' | 'solana'; raw: string }
  | { kind: 'invalid'; reason: string; raw: string };

/** 0x + 40 hex. Nothing else is an EVM address, and near-misses are usually a truncated paste. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Base58, 32-44 characters. Solana's alphabet excludes 0, O, I and l
 * precisely so a misread character cannot silently become a different
 * valid address — so a string containing one is not a Solana address, it
 * is a typo, and saying so is more useful than searching for it.
 */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A ticker: letters and digits, short. Long enough for "1000PEPEUSDT", short enough never to catch an address. */
const TICKER = /^[A-Za-z0-9]{2,20}$/;

/**
 * Quote assets a bare ticker is completed with, in order of preference.
 * USDT first because that is where the depth is on Binance; the caller
 * tries them in turn and uses the first that exists.
 */
export const QUOTE_FALLBACKS: readonly string[] = ['USDT', 'USDC', 'BTC'];

export function resolveQuery(raw: string): LookupQuery {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'invalid', reason: 'Nothing entered.', raw };

  if (EVM_ADDRESS.test(trimmed)) {
    // Case preserved: EVM addresses carry an optional checksum in their
    // casing, and folding it throws away a way to catch a bad paste.
    return { kind: 'address', address: trimmed, family: 'evm', raw };
  }

  // Tested before the ticker rule, because a 32-44 character base58 string
  // also matches "letters and digits" — length is what separates them.
  if (SOLANA_ADDRESS.test(trimmed) && trimmed.length >= 32) {
    return { kind: 'address', address: trimmed, family: 'solana', raw };
  }

  if (trimmed.startsWith('0x')) {
    // Close enough to an address to be one, and wrong. Searching for it as
    // a ticker would return nothing and blame the token.
    return {
      kind: 'invalid',
      reason: `"${trimmed}" looks like an EVM address but is malformed — 0x plus 40 hex characters, this has ${Math.max(0, trimmed.length - 2)}.`,
      raw,
    };
  }

  if (TICKER.test(trimmed)) {
    return { kind: 'exchange', symbol: trimmed.toUpperCase(), raw };
  }

  return {
    kind: 'invalid',
    reason: `Could not read "${trimmed}". Enter an exchange ticker (BTC, ETHUSDT) or a contract address.`,
    raw,
  };
}

/**
 * The Binance symbols to try for a ticker, most likely first.
 *
 * A ticker that already ends in a quote asset is taken as given — "BTCUSDC"
 * means that pair, and appending USDT to it would look up something that
 * does not exist and report the token as unlisted.
 */
export function candidateSymbols(symbol: string): string[] {
  const upper = symbol.toUpperCase();
  if (QUOTE_FALLBACKS.some((q) => upper.endsWith(q) && upper.length > q.length)) return [upper];
  return QUOTE_FALLBACKS.map((quote) => `${upper}${quote}`);
}
