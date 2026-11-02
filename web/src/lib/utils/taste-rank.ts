import { type Cell, createCell } from "./cell";

// How many components the decomposition has (DESIGN §2.5): the core is built
// for each from 1 to 6. It changes the list as well as the map, since the
// scores come from the same fit. Kept per device, as the theme is, and not
// forgotten on sign-out: it is a way of looking, not something about anybody.

export const LEAST_RANK = 1;
export const MOST_RANK = 6;
export const USUAL_RANK = 3;

const KEY = "grapevine-rank";

/** The rank nearest `value` that the core is built for. */
export function nearestRank(value: number): number {
  if (!Number.isFinite(value)) return USUAL_RANK;
  else return Math.min(MOST_RANK, Math.max(LEAST_RANK, Math.round(value)));
}

export const rankCell: Cell<number> = createCell(USUAL_RANK);

let read = false;

/**
 * The rank this device keeps, read from storage the first time it is asked
 * for. Never at module setup: the pages are prerendered, where there is no
 * storage, and a private window throws.
 */
export function currentRank(): number {
  if (!read) {
    read = true;
    try {
      const kept = window.localStorage.getItem(KEY);
      if (kept !== null) rankCell.set(nearestRank(Number(kept)));
    } catch {
      // No storage is the usual rank.
    }
  }
  return rankCell.get();
}

/** Sets the rank and keeps it; answers whether it changed. */
export function setRank(rank: number): boolean {
  const next = nearestRank(rank);
  if (next === currentRank()) return false;
  rankCell.set(next);
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // Kept for this visit only.
  }
  return true;
}
