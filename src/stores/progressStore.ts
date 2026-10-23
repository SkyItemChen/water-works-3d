/**
 * Progress: contract stars, best scores, daily leaderboards, share history.
 * Everything is stored locally; there is no backend.
 */

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { sortDailyEntries, type DailyLeaderboardEntry } from '../game/core/daily';
import type { ShareHistoryEntry } from '../game/core/types';

const KEY = 'waterworks3d.progress.v1';

export interface LevelRecord {
  stars: number;
  bestScore: number;
  bestBlocks: number;
  cleared: boolean;
  attempts: number;
  lastPlayed: number;
}

interface ProgressData {
  levels: Record<string, LevelRecord>;
  daily: Record<string, DailyLeaderboardEntry[]>;
  shareHistory: ShareHistoryEntry[];
  endlessBest: number;
  totalRuns: number;
  totalScore: number;
  /** Tutorial seen. Missing on old saves — treated as false (not done). */
  tutorialDone: boolean;
}

function emptyData(): ProgressData {
  return {
    levels: {},
    daily: {},
    shareHistory: [],
    endlessBest: 0,
    totalRuns: 0,
    totalScore: 0,
    tutorialDone: false,
  };
}

function load(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as Partial<ProgressData>;
    return {
      levels: parsed.levels ?? {},
      daily: parsed.daily ?? {},
      shareHistory: parsed.shareHistory ?? [],
      endlessBest: parsed.endlessBest ?? 0,
      totalRuns: parsed.totalRuns ?? 0,
      totalScore: parsed.totalScore ?? 0,
      // Old saves have no field; a missing value means "not seen yet".
      tutorialDone: parsed.tutorialDone === true,
    };
  } catch {
    return emptyData();
  }
}

export const useProgressStore = defineStore('progress', () => {
  const data = ref<ProgressData>(load());
  const lastSaved = ref(Date.now());

  function persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(data.value));
      lastSaved.value = Date.now();
    } catch {
      /* ignore quota errors */
    }
  }

  watch(data, persist, { deep: true });

  const levelRecords = computed(() => data.value.levels);
  const totalStars = computed(() =>
    Object.values(data.value.levels).reduce((sum, r) => sum + (r.stars ?? 0), 0),
  );
  const clearedCount = computed(
    () => Object.values(data.value.levels).filter((r) => r.cleared).length,
  );
  const shareHistory = computed(() => data.value.shareHistory);

  function recordLevel(
    id: string,
    stars: number,
    score: number,
    blocks: number,
    cleared: boolean,
  ): void {
    const prev = data.value.levels[id];
    const rec: LevelRecord = prev ?? {
      stars: 0,
      bestScore: 0,
      bestBlocks: 0,
      cleared: false,
      attempts: 0,
      lastPlayed: 0,
    };
    rec.stars = Math.max(rec.stars, stars);
    rec.bestScore = Math.max(rec.bestScore, score);
    if (cleared) {
      rec.bestBlocks = rec.bestBlocks === 0 ? blocks : Math.min(rec.bestBlocks, blocks);
    }
    rec.cleared = rec.cleared || cleared;
    rec.attempts += 1;
    rec.lastPlayed = Date.now();
    data.value.levels[id] = rec;
    data.value.totalRuns += 1;
    data.value.totalScore += Math.max(0, score);
  }

  function recordEndless(score: number): void {
    data.value.endlessBest = Math.max(data.value.endlessBest, score);
  }

  function recordDaily(date: string, score: number, blocks: number, won: boolean): void {
    const list = data.value.daily[date] ?? [];
    list.push({ date, score, blocks, won, at: Date.now() });
    data.value.daily[date] = sortDailyEntries(list).slice(0, 20);
  }

  function dailyBoard(date: string): DailyLeaderboardEntry[] {
    return sortDailyEntries(data.value.daily[date] ?? []);
  }

  function dailyBest(date: string): DailyLeaderboardEntry | null {
    return dailyBoard(date)[0] ?? null;
  }

  function addShare(entry: ShareHistoryEntry): void {
    // De-duplicate by code, newest first.
    const list = data.value.shareHistory.filter((x) => x.code !== entry.code);
    list.unshift(entry);
    data.value.shareHistory = list.slice(0, 30);
  }

  function removeShare(code: string): void {
    data.value.shareHistory = data.value.shareHistory.filter((x) => x.code !== code);
  }

  function resetLevels(): void {
    data.value.levels = {};
  }

  /** Tutorial seen. Set by the tutorial store on skip or on the final step. */
  function markTutorialDone(): void {
    data.value.tutorialDone = true;
  }

  const tutorialDone = computed(() => data.value.tutorialDone === true);
  /** True while the player has never seen the tutorial (old saves included). */
  const tutorialIsNew = computed(() => data.value.tutorialDone !== true);

  function resetAll(): void {
    data.value = emptyData();
  }

  return {
    data,
    lastSaved,
    levelRecords,
    totalStars,
    clearedCount,
    shareHistory,
    tutorialDone,
    tutorialIsNew,
    markTutorialDone,
    recordLevel,
    recordEndless,
    recordDaily,
    dailyBoard,
    dailyBest,
    addShare,
    removeShare,
    resetLevels,
    resetAll,
  };
});
