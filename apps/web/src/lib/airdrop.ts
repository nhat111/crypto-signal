import { parseDecimalInput } from './parseDecimal';
import type { AirdropCandidate, Farm } from './types';

/**
 * Four orderings, each answering its own question, instead of one score
 * that would quietly pick a question for the reader (ASSUMPTIONS.md §25).
 */
export type AirdropSort = 'tvl' | 'growth7d' | 'growth30d' | 'newest';

export const AIRDROP_SORTS: { id: AirdropSort; label: string }[] = [
  { id: 'tvl', label: 'TVL lớn nhất' },
  { id: 'growth7d', label: 'Tăng 7 ngày' },
  { id: 'growth30d', label: 'Tăng 30 ngày' },
  { id: 'newest', label: 'Mới lên' },
];

/** Unknown values sort last in every order, never as if they were zero. */
function desc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortCandidates(list: readonly AirdropCandidate[], sort: AirdropSort): AirdropCandidate[] {
  const copy = [...list];
  switch (sort) {
    case 'tvl':
      return copy.sort((a, b) => b.tvlUsd - a.tvlUsd);
    case 'growth7d':
      return copy.sort((a, b) => desc(a.change7dPct, b.change7dPct));
    case 'growth30d':
      return copy.sort((a, b) => desc(a.change30dPct, b.change30dPct));
    case 'newest':
      return copy.sort((a, b) => desc(a.listedAtMs, b.listedAtMs));
  }
}

/** Matches name, category or any chain, case-insensitively. */
export function filterCandidates(list: readonly AirdropCandidate[], query: string): AirdropCandidate[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...list];
  return list.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.category ?? '').toLowerCase().includes(q) ||
      c.chains.some((chain) => chain.toLowerCase().includes(q)),
  );
}

/** A cost may be 0 (a free action) but never negative; blank means 0. */
export function parseCostInput(raw: string): number | null {
  if (raw.trim() === '') return 0;
  const value = parseDecimalInput(raw);
  return value !== null && value >= 0 ? value : null;
}

/** The farm that should be on the active list for this candidate, if any. */
export function activeFarmFor(candidate: AirdropCandidate, farms: readonly Farm[]): Farm | undefined {
  const key = candidate.name.trim().replace(/\s+/g, ' ').toLowerCase();
  return farms.find((f) => f.status === 'active' && (f.slug === candidate.slug || f.projectKey === key));
}

/** Days without an action after which a farm is called out: most criteria count active weeks. */
export const FARM_QUIET_DAYS = 14;

/** "$1.2", "-$1.55": the sign goes before the dollar sign. */
export function formatFarmUsd(value: number): string {
  const abs = `$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return value < 0 ? `-${abs}` : abs;
}

/** Relative time in Vietnamese, for the rest of this page's language. */
export function formatAgoVi(timestampMs: number, nowMs: number): string {
  const min = Math.round((nowMs - timestampMs) / 60_000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}
