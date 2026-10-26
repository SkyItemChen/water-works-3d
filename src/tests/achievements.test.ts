import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achievementProgress, earned, type AchievementStats } from '../game/core/achievements';

const base = (over: Partial<AchievementStats> = {}): AchievementStats => ({
  clearedLevels: 0,
  totalLevels: 60,
  threeStarLevels: 0,
  challengeCleared: 0,
  challengePassed: 0,
  challengeTotal: 60,
  challengeConceded: 0,
  challengeStreak: 0,
  bestChallengeStreak: 0,
  ...over,
});

describe('achievements', () => {
  it('an empty save earns nothing', () => {
    expect(earned(base())).toEqual([]);
  });

  it('the first clear and the first three-star unlock on merit', () => {
    expect(earned(base({ clearedLevels: 1 }))).toEqual(['first_clear']);
    expect(earned(base({ clearedLevels: 1, threeStarLevels: 1 }))).toEqual([
      'first_clear',
      'three_star',
    ]);
  });

  it('star tiers are cumulative and ordered', () => {
    expect(earned(base({ threeStarLevels: 30 }))).toContain('star_collector');
    expect(earned(base({ threeStarLevels: 60 }))).toContain('star_perfect');
    expect(earned(base({ threeStarLevels: 59 }))).not.toContain('star_perfect');
  });

  it('challenge tiers count self-clears, not concessions', () => {
    // Conceding every level passes them all but earns no challenge tier.
    const concededAll = base({ challengePassed: 60, challengeConceded: 60 });
    expect(earned(concededAll)).toEqual(['concede_first']);
    expect(earned(base({ challengeCleared: 1 }))).toContain('challenge_first');
    expect(earned(base({ challengeCleared: 10 }))).toContain('challenge_ten');
    expect(earned(base({ challengeCleared: 30 }))).toContain('challenge_thirty');
    expect(earned(base({ challengeCleared: 60 }))).toContain('challenge_all');
    expect(earned(base({ challengeCleared: 59 }))).not.toContain('challenge_all');
  });

  it('the concession achievements need the whole set passed', () => {
    expect(earned(base({ challengePassed: 60, challengeConceded: 0 }))).toContain('challenge_pure');
    expect(earned(base({ challengePassed: 60, challengeConceded: 3 }))).toContain('challenge_few');
    expect(earned(base({ challengePassed: 60, challengeConceded: 3 }))).not.toContain(
      'challenge_pure',
    );
    expect(earned(base({ challengePassed: 60, challengeConceded: 4 }))).not.toContain(
      'challenge_few',
    );
    // Partial sets never earn them, however few concessions.
    expect(earned(base({ challengePassed: 59, challengeConceded: 0 }))).not.toContain(
      'challenge_few',
    );
  });

  it('the streak achievement reads the best streak, not the current one', () => {
    expect(earned(base({ bestChallengeStreak: 10, challengeStreak: 0 }))).toContain('streak_ten');
    expect(earned(base({ bestChallengeStreak: 9 }))).not.toContain('streak_ten');
  });

  it('every achievement carries a name, a description and a tier', () => {
    for (const def of ACHIEVEMENTS) {
      expect(def.name.length).toBeGreaterThan(1);
      expect(def.desc.length).toBeGreaterThan(4);
      expect(['bronze', 'silver', 'gold', 'platinum']).toContain(def.tier);
    }
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('progress text never throws and counts against the right totals', () => {
    const stats = base({ clearedLevels: 12, threeStarLevels: 7, challengeCleared: 3 });
    expect(achievementProgress('first_clear', stats)).toBe('12/60');
    expect(achievementProgress('three_star', stats)).toBe('7/60');
    expect(achievementProgress('challenge_ten', stats)).toBe('3/60');
    expect(achievementProgress('challenge_few', stats)).toContain('通过 0/60');
  });
});
