/**
 * Daily challenge: a deterministic date seed shared by every player offline.
 * Format: YYYY-MM-DD in local time. The level is contract 05's geometry with a
 * date-derived seed and a fixed block sequence.
 */

import { endlessLevel, contractLevels } from './level';
import type { BlockKind, LevelDefinition } from './types';

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dateSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DAILY_POOLS: BlockKind[][] = [
  ['pocket', 'pocket', 'pocket', 'soil2', 'sponge', 'pipe', 'filter'],
  ['pocket', 'pocket', 'pocketDirty', 'filter', 'sponge', 'soilL', 'valve'],
  ['pocket', 'pocket', 'pocket', 'pipe', 'ice', 'soil2', 'sponge'],
  ['pocket', 'pocket', 'pocket', 'pocketDirty', 'valve', 'soil2', 'filter'],
];

export function dailyLevel(dateKey = todayKey()): LevelDefinition {
  return dailyLevelFromSeed(dateSeed(`daily:${dateKey}`), dateKey);
}

/**
 * Rebuild a daily level from its seed alone. The date only affects the seed,
 * and the seed determines the pool, so a share code never needs the date.
 */
export function dailyLevelFromSeed(seed: number, label = '每日挑战'): LevelDefinition {
  const pool = DAILY_POOLS[seed % DAILY_POOLS.length];
  // Base geometry: level 10 has clean and dirty drains on separate sides,
  // which keeps the daily board readable and always solvable.
  const base = contractLevels()[9];
  return {
    ...base,
    id: 'daily',
    index: 1000,
    name: `${label} ${seed % 10000}`,
    subtitle: '每日挑战 · 固定块序',
    mechanic: '每日固定种子',
    intro: '同一天的所有玩家拿到同一套块序，比分数也比块数。',
    seed,
    // Daily runs start with a dry shaft: no pre-filled water, so every player
    // begins from an identical, readable board.
    initialWater: [],
    pool: pool.slice(),
    blockLimit: 18,
    fallInterval: 24,
    goals: [
      { type: 'drainClean', amount: 14 },
      { type: 'waterline', row: 3 },
    ],
    star3Blocks: 9,
    endless: false,
  };
}

export function endlessDailyLevel(): LevelDefinition {
  return endlessLevel(dateSeed(todayKey()));
}

export interface DailyLeaderboardEntry {
  date: string;
  score: number;
  blocks: number;
  won: boolean;
  at: number;
}

/** Sort for the local leaderboard: wins first, then score, then fewer blocks. */
export function sortDailyEntries(entries: DailyLeaderboardEntry[]): DailyLeaderboardEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.won !== b.won) return a.won ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.blocks - b.blocks;
  });
}

export function bestDaily(entries: DailyLeaderboardEntry[]): DailyLeaderboardEntry | null {
  return sortDailyEntries(entries)[0] ?? null;
}

export function daysAgo(n: number, from = new Date()): string {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() - n);
  return todayKey(d);
}
