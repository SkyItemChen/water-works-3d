/**
 * Campaign pagination + sequential unlocking.
 *
 * Pure functions so the level-select screen, tests and any future menu share
 * exactly one definition of "unlocked".
 */

export const LEVELS_PER_PAGE = 10;

/** Clamp a page number to the real range. */
export function clampCampaignPage(page: number, totalLevels: number): number {
  const pages = Math.max(1, Math.ceil(totalLevels / LEVELS_PER_PAGE));
  return Math.max(1, Math.min(pages, Math.trunc(page) || 1));
}

export function campaignPageCount(totalLevels: number): number {
  return Math.max(1, Math.ceil(totalLevels / LEVELS_PER_PAGE));
}

/** 1-based level index -> 1-based page number. */
export function campaignPageForIndex(index: number): number {
  return Math.max(1, Math.floor((Math.max(1, index) - 1) / LEVELS_PER_PAGE) + 1);
}

/** Slice one page out of an ordered level list. */
export function campaignPageSlice<T>(items: readonly T[], page: number): T[] {
  const p = clampCampaignPage(page, items.length);
  const start = (p - 1) * LEVELS_PER_PAGE;
  return items.slice(start, start + LEVELS_PER_PAGE);
}

/**
 * The first level is always open; every other level needs the immediately
 * previous one cleared.
 */
export function isLevelUnlocked(index: number, isCleared: (index: number) => boolean): boolean {
  return index <= 1 || isCleared(index - 1);
}

/** Index of the earliest unfinished level, which is always playable in a chain. */
export function firstPlayableIndex(
  levels: readonly { index: number }[],
  isCleared: (index: number) => boolean,
): number {
  return levels.find((l) => !isCleared(l.index))?.index ?? levels[levels.length - 1]?.index ?? 1;
}
