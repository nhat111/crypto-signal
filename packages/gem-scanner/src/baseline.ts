import type { EligibilityFailure } from './scoring.js';

/**
 * The control group for "is any of this worth trading?".
 *
 * The band comparison on /gems answers whether the score *ranks* correctly
 * among the tokens that passed the gate. It cannot answer the question the
 * money actually depends on — whether passing the gate beat not bothering —
 * because every row in it went through the same filter. A hit rate with no
 * control is the one thing this codebase refuses to publish, and the gem
 * page has been publishing one.
 *
 * So a sample of *rejected* candidates is priced alongside the real ones.
 *
 * Not every reject is a fair control, and picking the wrong ones would
 * flatter the scanner rather than test it:
 *
 * - `liquidity_too_low` / `volume_too_low` — a pool nobody trades. Its
 *   printed price move is mostly an artefact; you could not have taken
 *   that trade at that price, so counting it as an alternative is
 *   fiction.
 * - `missing_*_data` — we could not read it then and cannot price it
 *   honestly now.
 * - Anything the safety screen rejected never reaches this list: it is
 *   scored only after the market gate passes, and "you could have bought
 *   the rug instead" is not a comparison anyone wants.
 *
 * What is left is the honest control: tokens that were simply the wrong
 * *profile* — too big, too new, or already pumped. Every one of those is
 * something a person could genuinely have bought that day instead.
 */
export const COMPARABLE_FAILURES: readonly EligibilityFailure[] = [
  'liquidity_too_high',
  'fdv_too_high',
  'too_young',
  'extreme_pump',
];

/**
 * True when this rejection is comparable — i.e. *every* reason it failed
 * is a profile reason. One untradeable or unreadable reason is enough to
 * disqualify it, because the token still has that property.
 */
export function isComparableReject(failures: EligibilityFailure[], priceUsd: number | null): boolean {
  if (priceUsd === null || priceUsd <= 0) return false;
  if (failures.length === 0) return false;
  return failures.every((f) => COMPARABLE_FAILURES.includes(f));
}

/**
 * A bounded random subset, so the control costs a fixed number of rows and
 * price lookups per scan however many candidates were rejected.
 *
 * Random rather than "the first N": candidates arrive in discovery order,
 * which correlates with volume and recency on every feed we read. Taking
 * the head would quietly build a control group of the biggest, newest
 * rejects and then compare the scanner against it.
 *
 * The RNG is injected so the selection is testable — the sampling is the
 * part that decides whether the baseline means anything.
 */
export function sampleRejects<T>(items: T[], limit: number, random: () => number = Math.random): T[] {
  if (limit <= 0) return [];
  if (items.length <= limit) return [...items];

  // Partial Fisher-Yates: shuffle only the first `limit` positions, which
  // is a uniform sample without building a full permutation.
  const pool = [...items];
  for (let i = 0; i < limit; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    const a = pool[i] as T;
    pool[i] = pool[j] as T;
    pool[j] = a;
  }
  return pool.slice(0, limit);
}
