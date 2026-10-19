/**
 * Daily open interest summed across exchanges, for the coin scan's 7-day
 * OI change.
 *
 * One exchange's OI is one venue's crowd: a coin whose leverage moved to
 * Bybit reads as "OI falling" on Binance alone. Summed in coins (never
 * USD, which price alone moves), the change is the market's, not a
 * venue's.
 *
 * The sum is only honest on days every venue in it reported: a venue that
 * joins halfway through the week would read as fresh positions. So the
 * days are the ones the primary venue (the scan's own exchange) and every
 * included venue share; a venue whose days do not cover the window is
 * dropped for that coin rather than shortening or bending it.
 */

export interface OiDay {
  /** Epoch millis of the UTC day the snapshot belongs to. */
  time: number;
  /** Open interest in coins of the base asset. */
  coins: number;
}

export interface VenueOi {
  venue: string;
  days: OiDay[];
}

export interface SummedOi {
  /** Summed coins per day, oldest first. At most `points` long. */
  coins: number[];
  /** Venues in the sum, primary first. */
  venues: string[];
}

const valid = (days: OiDay[]): Map<number, number> =>
  new Map(days.filter((d) => Number.isFinite(d.time) && Number.isFinite(d.coins) && d.coins > 0).map((d) => [d.time, d.coins]));

export function sumDailyOpenInterest(primary: VenueOi, extras: VenueOi[], points: number): SummedOi {
  const base = valid(primary.days);
  const extraMaps = extras.map((e) => ({ venue: e.venue, days: valid(e.days) })).filter((e) => e.days.size > 0);
  const baseTimes = [...base.keys()].sort((a, b) => a - b);

  // Greedy: while the shared days cannot fill the window, drop the venue
  // that shares the fewest with the primary. A venue missing only the
  // forming day therefore costs the window that day, not its whole place.
  let included = extraMaps;
  let shared = baseTimes;
  for (;;) {
    shared = baseTimes.filter((t) => included.every((e) => e.days.has(t)));
    if (shared.length >= points || included.length === 0) break;
    const overlap = (e: (typeof included)[number]): number => baseTimes.filter((t) => e.days.has(t)).length;
    const worst = included.reduce((a, b) => (overlap(b) < overlap(a) ? b : a));
    included = included.filter((e) => e !== worst);
  }

  const window = shared.slice(-points);
  return {
    coins: window.map((t) => (base.get(t) as number) + included.reduce((s, e) => s + (e.days.get(t) as number), 0)),
    venues: [primary.venue, ...included.map((e) => e.venue)],
  };
}
