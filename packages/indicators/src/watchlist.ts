import type { CoinFlow } from './coinScan.js';
import type { CoinFundamentals } from './coinFundamentals.js';

/**
 * Which scanned coins are worth watching for an entry.
 *
 * The scan says which coins have been stronger than BTC; it does not say
 * when to buy one. The watchlist is the hand-off: a short list of coins the
 * 4H setup detector is pointed at and alerts on. Every rule is one a reader
 * can check against the /coins table:
 *
 * - stronger than BTC over 30 days, and the RS line still above its own
 *   20-day average (strength that is fading is not kept);
 * - no selling flow over the last 7 days (spot sold into, shorts added, or
 *   flat while spot sells);
 * - not a coin whose usage figures only point down (DefiLlama has bearish
 *   drivers and no bullish one);
 * - the strongest by 30-day RS first, up to `size`.
 *
 * No score: each rule is a gate, and the order is relative strength alone.
 * Whether any of this picks better setups is not assumed — every other
 * scanned coin is run through the same detector as the baseline.
 */

export interface WatchlistCandidate {
  symbol: string;
  rs30d: number | null;
  rsAboveSma20: boolean | null;
  flow: CoinFlow;
  fundamentals: CoinFundamentals | null;
}

/** Labels where the last week's flow is sellers'. */
export const SELLING_FLOWS: readonly CoinFlow[] = ['spot_selling', 'shorts_building', 'distribution'];

export const DEFAULT_WATCHLIST_SIZE = 6;

export function pickWatchlist<T extends WatchlistCandidate>(rows: T[], size = DEFAULT_WATCHLIST_SIZE, exclude: readonly string[] = []): T[] {
  return rows
    .filter(
      (r) =>
        !exclude.includes(r.symbol) &&
        r.rs30d !== null &&
        r.rs30d > 0 &&
        r.rsAboveSma20 === true &&
        !SELLING_FLOWS.includes(r.flow) &&
        !(r.fundamentals && r.fundamentals.bear.length > 0 && r.fundamentals.bull.length === 0),
    )
    .sort((a, b) => (b.rs30d as number) - (a.rs30d as number))
    .slice(0, Math.max(0, size));
}
