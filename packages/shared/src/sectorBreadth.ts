/**
 * How widely a sector is moving: the share of its coins beating BTC over
 * 7 days, put in one word so a card or a bot line reads at a glance.
 *
 * Shared by the sector read (whose "Rộng"/"Hẹp" notes use the same edges)
 * and the bot; the web keeps a copy in lib/narratives.ts because it does
 * not import workspace packages. Change all three together.
 */
export const SECTOR_BROAD_BREADTH_PCT = 65;
export const SECTOR_NARROW_BREADTH_PCT = 35;

export type SectorBreadthWord = 'Rộng' | 'Vừa' | 'Ít';

export function sectorBreadthWord(breadthPct: number): SectorBreadthWord {
  if (breadthPct >= SECTOR_BROAD_BREADTH_PCT) return 'Rộng';
  if (breadthPct >= SECTOR_NARROW_BREADTH_PCT) return 'Vừa';
  return 'Ít';
}
