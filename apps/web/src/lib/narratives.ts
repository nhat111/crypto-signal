import type { FlywheelRow, SectorLabel } from './types';

export const SECTOR_LABEL_META: Record<SectorLabel, { text: string; className: string; hint: string }> = {
  leading: { text: 'Dẫn dắt', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', hint: 'Thắng BTC cả 7 lẫn 30 ngày' },
  emerging: { text: 'Đang nổi', className: 'border-sky-500/30 bg-sky-500/10 text-sky-300', hint: 'Thắng BTC 7 ngày, chưa thắng 30 ngày' },
  fading: { text: 'Hạ nhiệt', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300', hint: 'Thắng BTC 30 ngày nhưng tuần này thua' },
  lagging: { text: 'Yếu', className: 'border-slate-700 bg-slate-800/60 text-slate-400', hint: 'Thua BTC cả hai khung' },
};

/**
 * How widely a sector moves, in one word. A copy of sectorBreadthWord in
 * packages/shared (the web does not import workspace packages); keep the
 * edges the same there and in the sector read's notes.
 */
export function breadthWord(breadthPct: number): { text: 'Rộng' | 'Vừa' | 'Ít'; className: string } {
  if (breadthPct >= 65) return { text: 'Rộng', className: 'text-emerald-300' };
  if (breadthPct >= 35) return { text: 'Vừa', className: 'text-slate-300' };
  return { text: 'Ít', className: 'text-slate-500' };
}

export const SECTOR_LABEL_ORDER: SectorLabel[] = ['leading', 'emerging', 'fading', 'lagging'];

/** Separate questions, no blended ranking (ASSUMPTIONS.md §26). */
export type FlywheelSort = 'revenue' | 'yield' | 'growth';

export const FLYWHEEL_SORTS: { id: FlywheelSort; label: string }[] = [
  { id: 'revenue', label: 'Trả nhiều nhất' },
  { id: 'yield', label: '%/năm vốn hoá' },
  { id: 'growth', label: 'Tăng so tháng trước' },
];

function desc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortFlywheel(rows: readonly FlywheelRow[], sort: FlywheelSort): FlywheelRow[] {
  const copy = [...rows];
  switch (sort) {
    case 'revenue':
      return copy.sort((a, b) => b.holdersRevenue30dUsd - a.holdersRevenue30dUsd);
    case 'yield':
      return copy.sort((a, b) => desc(a.yieldPct, b.yieldPct));
    case 'growth':
      return copy.sort((a, b) => desc(a.holdersRevenueChangePct, b.holdersRevenueChangePct));
  }
}

/** Rounded first, so -0.004 prints "0.0%" rather than a red "-0.0%". */
export function signedPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}%`;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}%`;
}

/** Green, red, or neutral for a value that rounds to zero at the shown precision. */
export function pctTone(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return 'text-slate-500';
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return 'text-slate-300';
  return rounded > 0 ? 'text-emerald-300' : 'text-rose-300';
}
