/**
 * Progress: contract stars, best scores, challenge clears, achievements,
 * daily leaderboards, share history. Everything is stored locally.
 */

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { sortDailyEntries, type DailyLeaderboardEntry } from '../game/core/daily';
import { contractLevels } from '../game/core/level';
import { CHALLENGE_ENTRIES, humanPaceEntries } from '../game/core/challenge';
import {
  ACHIEVEMENTS,
  earned,
  type AchievementDef,
  type AchievementStats,
} from '../game/core/achievements';
import type { ShareHistoryEntry } from '../game/core/types';
import { decodeStoredProgress, encodeSave, SAVE_PREFIX, type ProgressSave } from '../game/core/saveFile';
import { APP_VERSION } from '../game/core/version';

const KEY = 'waterworks3d.progress.v1';

export interface LevelRecord {
  stars: number;
  bestScore: number;
  bestBlocks: number;
  cleared: boolean;
  attempts: number;
  lastPlayed: number;
}

/** One campaign level played again under its best-known-score bar. */
export interface ChallengeRecord {
  /** the player reached the target without conceding */
  cleared: boolean;
  /** the player conceded: watched the official line instead */
  conceded: boolean;
  bestScore: number;
  attempts: number;
  lastPlayed: number;
}

interface ProgressData {
  levels: Record<string, LevelRecord>;
  challenge: Record<string, ChallengeRecord>;
  /** achievement id -> unlock timestamp */
  achievements: Record<string, number>;
  /** consecutive challenge self-clears without conceding */
  challengeStreak: number;
  bestChallengeStreak: number;
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
    challenge: {},
    achievements: {},
    challengeStreak: 0,
    bestChallengeStreak: 0,
    daily: {},
    shareHistory: [],
    endlessBest: 0,
    totalRuns: 0,
    totalScore: 0,
    tutorialDone: false,
  };
}

function emptyChallengeRecord(): ChallengeRecord {
  return { cleared: false, conceded: false, bestScore: 0, attempts: 0, lastPlayed: 0 };
}

function load(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    // Accepts the current base64 array text, the v0.10.0 JSON envelope and the
    // original bare object. Older shapes are rewritten on the next persist.
    const parsed = decodeStoredProgress(raw);
    return parsed ? { ...emptyData(), ...parsed.progress } : emptyData();
  } catch {
    return emptyData();
  }
}

export const useProgressStore = defineStore('progress', () => {
  const data = ref<ProgressData>(load());
  const lastSaved = ref(Date.now());
  /** Queue of ids unlocked since the UI last looked. Drained by the toast. */
  const recentUnlocks = ref<string[]>([]);

  function persist(): void {
    try {
      // Array layout + base64: no repeated key names, booleans as 0/1.
      localStorage.setItem(KEY, encodeSave(data.value, null, APP_VERSION));
      lastSaved.value = Date.now();
    } catch {
      /* ignore quota errors */
    }
  }

  watch(data, persist, { deep: true });

  // Same key, new format: rewrite a legacy value immediately so the compact form
  // is what sits on disk from now on (and a reload cannot resurrect the old one).
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && !raw.trim().startsWith(SAVE_PREFIX)) persist();
  } catch {
    /* storage disabled */
  }

  const levelRecords = computed(() => data.value.levels);
  const totalStars = computed(() =>
    Object.values(data.value.levels).reduce((sum, r) => sum + (r.stars ?? 0), 0),
  );
  /** Lifetime score: every finished attempt adds its score up. */
  const totalScore = computed(() => data.value.totalScore);
  const clearedCount = computed(
    () => Object.values(data.value.levels).filter((r) => r.cleared).length,
  );
  const shareHistory = computed(() => data.value.shareHistory);

  // --- Challenge mode ------------------------------------------------------
  const challengeRecords = computed(() => data.value.challenge);
  const challengeTotal = CHALLENGE_ENTRIES.length;
  const challengeClearedCount = computed(
    () => Object.values(data.value.challenge).filter((r) => r.cleared).length,
  );
  const challengeConcededCount = computed(
    () => Object.values(data.value.challenge).filter((r) => r.conceded).length,
  );
  const challengePassedCount = computed(
    () => Object.values(data.value.challenge).filter((r) => r.cleared || r.conceded).length,
  );

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
    syncAchievements();
  }

  /**
   * Record one challenge attempt. `cleared` means the player reached the target
   * themselves; a level that was already conceded keeps `cleared` false so the
   * "no concede" achievements stay honest.
   */
  function recordChallenge(id: string, score: number, cleared: boolean): void {
    const rec = data.value.challenge[id] ?? emptyChallengeRecord();
    rec.attempts += 1;
    rec.bestScore = Math.max(rec.bestScore, score);
    rec.lastPlayed = Date.now();
    if (cleared && !rec.conceded) {
      rec.cleared = true;
      data.value.challengeStreak += 1;
      data.value.bestChallengeStreak = Math.max(
        data.value.bestChallengeStreak,
        data.value.challengeStreak,
      );
    }
    data.value.challenge[id] = rec;
    syncAchievements();
  }

  /** Concede a challenge: the official replay unlocks and the streak breaks. */
  function concedeChallenge(id: string): void {
    const rec = data.value.challenge[id] ?? emptyChallengeRecord();
    if (!rec.conceded) {
      rec.conceded = true;
      rec.lastPlayed = Date.now();
      data.value.challenge[id] = rec;
      data.value.challengeStreak = 0;
    }
    syncAchievements();
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

  // --- Achievements --------------------------------------------------------
  /**
   * Levels whose only known line needs tick-0 timing are excluded from every
   * challenge achievement, denominator included: a bar no human can reproduce
   * must never gate a "clear them all" achievement (and conceding one is not a
   * stain either).
   */
  const humanChallengeIds = humanPaceEntries().map((e) => e.id);

  const achievementStats = computed<AchievementStats>(() => {
    const recs = Object.values(data.value.levels);
    const chals = humanChallengeIds
      .map((id) => data.value.challenge[id])
      .filter((r): r is NonNullable<typeof r> => !!r);
    return {
      clearedLevels: recs.filter((r) => r.cleared).length,
      totalLevels: contractLevels().length,
      threeStarLevels: recs.filter((r) => (r.stars ?? 0) >= 3).length,
      challengeCleared: chals.filter((r) => r.cleared).length,
      challengePassed: chals.filter((r) => r.cleared || r.conceded).length,
      challengeTotal: humanChallengeIds.length,
      challengeConceded: chals.filter((r) => r.conceded).length,
      challengeStreak: data.value.challengeStreak,
      bestChallengeStreak: data.value.bestChallengeStreak,
    };
  });

  const achievementUnlocks = computed(() => data.value.achievements);
  const achievementCount = computed(() => Object.keys(data.value.achievements).length);

  /**
   * Unlock everything the save file now earns. Idempotent: an id already in the
   * save file is never re-evaluated, so a level replay cannot re-toast it.
   */
  function syncAchievements(): string[] {
    const have = data.value.achievements;
    const stats = achievementStats.value;
    const now: string[] = [];
    for (const id of earned(stats)) {
      if (have[id]) continue;
      have[id] = Date.now();
      now.push(id);
    }
    if (now.length) recentUnlocks.value.push(...now);
    return now;
  }

  function consumeUnlocks(): string[] {
    if (!recentUnlocks.value.length) return [];
    const out = recentUnlocks.value.splice(0, recentUnlocks.value.length);
    return out;
  }

  /** Snapshot for export. Deep-cloned: the caller must never pinia-mutate it. */
  function exportData(): ProgressSave {
    return JSON.parse(JSON.stringify(data.value)) as ProgressSave;
  }

  /** Replace the whole save file (used by import). The deep watcher persists. */
  function replaceData(next: ProgressSave): void {
    data.value = next;
    recentUnlocks.value = [];
    syncAchievements();
  }

  /** Wipe the save file (settings live in their own store). */
  function formatSave(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage disabled: nothing to remove */
    }
    data.value = emptyData();
    recentUnlocks.value = [];
  }

  const achievementList = computed<{ def: AchievementDef; unlockedAt: number }[]>(() =>
    ACHIEVEMENTS.map((def) => ({ def, unlockedAt: data.value.achievements[def.id] ?? 0 })),
  );

  function resetAll(): void {
    data.value = emptyData();
  }

  return {
    data,
    lastSaved,
    levelRecords,
    totalStars,
    totalScore,
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
    // challenge
    challengeRecords,
    challengeTotal,
    challengeClearedCount,
    challengeConcededCount,
    challengePassedCount,
    recordChallenge,
    concedeChallenge,
    // achievements
    achievementList,
    achievementUnlocks,
    achievementCount,
    achievementStats,
    recentUnlocks,
    consumeUnlocks,
    syncAchievements,
    // save management
    exportData,
    replaceData,
    formatSave,
  };
});
