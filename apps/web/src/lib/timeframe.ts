import type { Timeframe } from './types';

/**
 * How long one candle covers. Used to judge a snapshot's age against what
 * its own frame can actually deliver.
 */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
};

/** The floor, matching the collector card on /status. */
export const MIN_STALE_MS = 15 * 60_000;

/**
 * How old a snapshot may get before it stops describing now.
 *
 * A fixed fifteen minutes was right while every surface read 5m and
 * becomes a permanent false alarm the moment one reads 4h: a 4h snapshot
 * is legitimately hours old for most of its life, so every card would
 * carry a "dữ liệu cũ" banner on a perfectly healthy feed. Half a period
 * of slack means one missed close is flagged and ordinary ageing is not.
 */
export function stalenessLimitMs(timeframe: Timeframe | undefined): number {
  // A frame this build has never heard of falls back to the floor rather
  // than to NaN — the API can serve a frame added after the web deployed,
  // and NaN here would silently switch the stale banner off entirely,
  // which fails in the one direction that matters.
  const periodMs = timeframe === undefined ? 0 : (TIMEFRAME_MS[timeframe] ?? 0);
  return Math.max(MIN_STALE_MS, periodMs * 1.5);
}

/**
 * The frame the Overview cards headline, when the reader has not chosen.
 *
 * 4h rather than 5m, and the same default the Telegram bot answers on: a
 * 5m health score flips several times inside a single decision, and 4h is
 * also the horizon /performance measures outcomes at. Someone watching
 * intraday can still pick a faster frame — that is what the picker is for.
 */
export const PREFERRED_OVERVIEW_TIMEFRAME: Timeframe = '4h';

/**
 * Resolve the frame to show, given what the reader last chose and what the
 * API actually collects.
 *
 * Never returns a frame the API does not serve: a stored preference for a
 * frame that has since been removed from TIMEFRAMES would leave every card
 * empty, which reads as "no data" rather than "that frame is gone".
 */
export function pickOverviewTimeframe(stored: string | null, available: Timeframe[]): Timeframe {
  if (available.length === 0) return PREFERRED_OVERVIEW_TIMEFRAME;
  const chosen = available.find((tf) => tf === stored);
  if (chosen) return chosen;
  if (available.includes(PREFERRED_OVERVIEW_TIMEFRAME)) return PREFERRED_OVERVIEW_TIMEFRAME;
  // Longest available: the slowest frame is the least noisy stand-in.
  return available[available.length - 1] ?? PREFERRED_OVERVIEW_TIMEFRAME;
}

const STORAGE_KEY = 'overview_timeframe';

/**
 * The stored preference, exposed as an external store.
 *
 * Not a lazy useState initializer and not a setState in an effect: this
 * page is prerendered, so the initializer would run where `window` does
 * not exist, and the effect version is a cascading render. useSyncExternal
 * Store is the shape that has neither problem — the server snapshot is
 * simply "nothing chosen".
 *
 * Snapshots are compared with Object.is, and equal strings are equal, so
 * returning a fresh read each call does not loop.
 */
const listeners = new Set<() => void>();

export function subscribeStoredTimeframe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Reading storage throws in some privacy modes; a missing preference is not an error. */
export function getStoredTimeframe(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** During prerender there is no reader and no preference — never a guess. */
export function getServerTimeframe(): string | null {
  return null;
}

export function storeTimeframe(timeframe: Timeframe): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, timeframe);
  } catch {
    // A preference that cannot be saved is a preference that does not
    // stick. Not worth surfacing, and never worth breaking the page over —
    // the listeners still fire so the choice applies for this visit.
  }
  for (const listener of listeners) listener();
}
