/**
 * Where to go and look at the contract yourself.
 *
 * A token page that shows numbers and no way to verify them asks to be
 * taken on trust, which is the opposite of what this project is for. The
 * explorer is where somebody checks the holder list, the mint authority
 * and the transfers with their own eyes.
 *
 * Only chains whose explorer URL shape is certain are listed. A wrong link
 * lands on "not found" and makes the reader doubt the ADDRESS — the one
 * piece of data that was definitely right — so an unmapped chain says it
 * has no explorer rather than guessing one.
 */
interface ExplorerSpec {
  name: string;
  /** `{address}` is substituted; nothing else is. */
  tokenUrl: string;
}

const EXPLORERS: Record<string, ExplorerSpec> = {
  solana: { name: 'Solscan', tokenUrl: 'https://solscan.io/token/{address}' },
  ethereum: { name: 'Etherscan', tokenUrl: 'https://etherscan.io/token/{address}' },
  bsc: { name: 'BscScan', tokenUrl: 'https://bscscan.com/token/{address}' },
  base: { name: 'BaseScan', tokenUrl: 'https://basescan.org/token/{address}' },
  polygon: { name: 'PolygonScan', tokenUrl: 'https://polygonscan.com/token/{address}' },
  arbitrum: { name: 'Arbiscan', tokenUrl: 'https://arbiscan.io/token/{address}' },
  optimism: { name: 'Optimistic Etherscan', tokenUrl: 'https://optimistic.etherscan.io/token/{address}' },
  avalanche: { name: 'Snowtrace', tokenUrl: 'https://snowtrace.io/token/{address}' },
  // robinhood is deliberately absent: its explorer URL shape has not been
  // verified here, and the same rule that keeps a guessed GeckoTerminal
  // slug out of the scanner keeps a guessed explorer out of this list.
};

export interface ExplorerLink {
  name: string;
  url: string;
}

export function explorerFor(chainId: string, tokenAddress: string): ExplorerLink | null {
  const spec = EXPLORERS[chainId.toLowerCase()];
  if (!spec || tokenAddress.trim() === '') return null;
  return { name: spec.name, url: spec.tokenUrl.replace('{address}', encodeURIComponent(tokenAddress)) };
}

/** Chains with a verified explorer, for saying which ones are covered. */
export const EXPLORER_CHAINS: readonly string[] = Object.keys(EXPLORERS);

/**
 * The exchange's own page for a pair.
 *
 * Constructed rather than looked up, because Binance's trade URL takes the
 * base and quote split by an underscore and the symbol is already known to
 * exist — the lookup only returns a symbol after candles came back for it.
 */
export function binanceTradeUrl(symbol: string, quotes: readonly string[]): string | null {
  const upper = symbol.toUpperCase();
  const quote = quotes.find((q) => upper.endsWith(q) && upper.length > q.length);
  if (quote === undefined) return null;
  return `https://www.binance.com/en/trade/${upper.slice(0, -quote.length)}_${quote}`;
}
