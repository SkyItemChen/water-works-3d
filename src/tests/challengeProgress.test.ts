import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useProgressStore } from '../stores/progressStore';
import { CHALLENGE_ENTRIES } from '../game/core/challenge';

/**
 * Challenge bookkeeping lives in the save file, so it needs a guard that does
 * not involve the engine: does a concede really block the "no concede"
 * achievements, does a streak break, does format-save actually wipe.
 */
const memory: Record<string, string> = {};

function installStorage(): void {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => memory[k] ?? null,
    setItem: (k: string, v: string) => {
      memory[k] = String(v);
    },
    removeItem: (k: string) => {
      delete memory[k];
    },
  };
}

describe('challenge progress', () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key];
    installStorage();
    setActivePinia(createPinia());
  });

  it('a clean challenge clear counts, unlocks and starts a streak', () => {
    const p = useProgressStore();
    p.recordChallenge('c01', 135, true);
    expect(p.challengeRecords.c01?.cleared).toBe(true);
    expect(p.challengeClearedCount).toBe(1);
    expect(p.data.challengeStreak).toBe(1);
    expect(p.achievementUnlocks.challenge_first).toBeTruthy();
    expect(p.recentUnlocks.length).toBeGreaterThan(0);
  });

  it('a short run records the attempt but clears nothing', () => {
    const p = useProgressStore();
    p.recordChallenge('c01', 90, false);
    expect(p.challengeRecords.c01?.cleared).toBe(false);
    expect(p.challengeRecords.c01?.bestScore).toBe(90);
    expect(p.challengeRecords.c01?.attempts).toBe(1);
    expect(p.challengeClearedCount).toBe(0);
  });

  it('conceding breaks the streak and blocks a later self-clear claim', () => {
    const p = useProgressStore();
    p.recordChallenge('c01', 135, true);
    expect(p.data.challengeStreak).toBe(1);

    p.recordChallenge('c02', 100, false);
    p.concedeChallenge('c02');
    expect(p.challengeRecords.c02?.conceded).toBe(true);
    expect(p.data.challengeStreak).toBe(0);
    expect(p.challengeConcededCount).toBe(1);
    expect(p.achievementUnlocks.concede_first).toBeTruthy();

    // Playing it again and hitting the bar does not rewrite history.
    p.recordChallenge('c02', 500, true);
    expect(p.challengeRecords.c02?.cleared).toBe(false);
    expect(p.challengeClearedCount).toBe(1);
    // ...but the level is passed as far as the "all passed" achievements go.
    expect(p.challengePassedCount).toBe(2);
    expect(p.data.challengeStreak).toBe(0);
  });

  it('conceding twice is idempotent for counts and streaks', () => {
    const p = useProgressStore();
    p.recordChallenge('c03', 10, false);
    p.concedeChallenge('c03');
    p.concedeChallenge('c03');
    expect(p.challengeConcededCount).toBe(1);
  });

  it('the streak achievement unlocks at ten in a row', () => {
    const p = useProgressStore();
    for (let i = 1; i <= 9; i++) p.recordChallenge(`c${String(i).padStart(2, '0')}`, 100, true);
    expect(p.achievementUnlocks.streak_ten).toBeFalsy();
    p.recordChallenge('c10', 100, true);
    expect(p.data.challengeStreak).toBe(10);
    expect(p.achievementUnlocks.streak_ten).toBeTruthy();
  });

  it('format-save wipes challenge, achievements and streaks', () => {
    const p = useProgressStore();
    p.recordChallenge('c01', 135, true);
    p.concedeChallenge('c02');
    expect(Object.keys(p.achievementUnlocks).length).toBeGreaterThan(0);

    p.formatSave();
    expect(p.challengeClearedCount).toBe(0);
    expect(p.challengeConcededCount).toBe(0);
    expect(p.achievementCount).toBe(0);
    expect(p.data.challengeStreak).toBe(0);
    expect(p.recentUnlocks.length).toBe(0);
    expect(memory['waterworks3d.progress.v1']).toBeUndefined();
  });

  it('clearing every challenge unlocks both platinum tiers, conceding one blocks them', () => {
    const p = useProgressStore();
    for (const e of CHALLENGE_ENTRIES) p.recordChallenge(e.id, e.target, true);
    expect(p.achievementUnlocks.challenge_all).toBeTruthy();
    expect(p.achievementUnlocks.challenge_pure).toBeTruthy();

    // Same set, but one level conceded: passed everywhere, self-cleared once less.
    // Achievements never get revoked, so the concession has to come first.
    setActivePinia(createPinia());
    const q = useProgressStore();
    const conceded = CHALLENGE_ENTRIES[0];
    q.concedeChallenge(conceded.id);
    for (const e of CHALLENGE_ENTRIES) {
      if (e.id !== conceded.id) q.recordChallenge(e.id, e.target, true);
    }
    q.syncAchievements();
    expect(q.challengePassedCount).toBe(CHALLENGE_ENTRIES.length);
    expect(q.achievementUnlocks.challenge_pure).toBeFalsy();
    expect(q.achievementUnlocks.challenge_all).toBeFalsy();
    expect(q.achievementUnlocks.challenge_few).toBeTruthy();
  });
});
