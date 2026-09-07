import type { Trade } from './types';
import { formatRelativeTime, formatTokenPrice } from './format';


/**
 * How an open position's estimated P&L is worded.
 *
 * Every string here works to keep the estimate from being mistaken for the
 * realized number next to it. A settled trade's P&L was priced from the
 * exit the user got and never moves; this one is computed from a price
 * nobody transacted at and changes on every poll. So it is prefixed, it is
 * dimmer, and when there is no price it says WHY rather than showing a
 * dash that looks like zero.
 */

/** A percentage the reader can tell is an estimate at a glance. */
export function unrealizedLabel(trade: Pick<Trade, 'unrealizedPnlPct'>): string | null {
  const pct = trade.unrealizedPnlPct;
  if (pct === null || pct === undefined) return null;
  return `≈ ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/**
 * The price the estimate came from, with its age — or, when there isn't
 * one, the reason in words the user can act on.
 *
 * The ambiguous-ticker case is the one worth spelling out: it has a fix
 * (log the contract address instead), and "no price" would hide it.
 */
export function markPriceNote(
  trade: Pick<Trade, 'markPrice' | 'markPriceAt' | 'markPriceUnknownReason'>,
  nowMs: number | null,
): string | null {
  if (trade.markPrice !== null && trade.markPrice !== undefined) {
    const known = nowMs !== null && trade.markPriceAt !== null && trade.markPriceAt !== undefined;
    // No clock from the server means no age — better a bare price than one
    // aged against the phone's clock, which can be minutes out.
    // The journal is English; the status page's `ago` is Vietnamese, and
    // borrowing it put "11 phút trước" inside an English table.
    const age = known ? formatRelativeTime(trade.markPriceAt as number, nowMs as number) : null;
    return age === null ? formatTokenPrice(trade.markPrice) : `${formatTokenPrice(trade.markPrice)} · ${age}`;
  }

  switch (trade.markPriceUnknownReason) {
    case 'ambiguous_ticker':
      return 'several tokens share this ticker — log the contract address to price it';
    case 'not_found':
      return 'no price source for this symbol';
    default:
      // Undefined reason means an API that predates this feature, not a
      // failed lookup. Saying nothing is the honest rendering.
      return null;
  }
}

/**
 * Whether the API answering is older than this page.
 *
 * A dash currently means two different things: "we computed this and there
 * is nothing to show" and "the server never sent this field". The second
 * happens on every release — Vercel and Railway finish minutes apart — and
 * it renders as a panel of blanks that looks like a broken token rather
 * than a deploy still in flight.
 *
 * Absent is the tell. `null` is a computed answer; `undefined` is a field
 * that was never in the payload, so a reading that is undefined across the
 * board means the response predates them all.
 */
export function apiPredatesReadings(read: {
  volumeRatio?: number | null;
  windowHigh?: unknown;
  rsi14Percentile?: number | null;
}): boolean {
  return read.volumeRatio === undefined && read.windowHigh === undefined && read.rsi14Percentile === undefined;
}
