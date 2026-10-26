/**
 * Achievements — pure definitions plus the predicate that decides whether a
 * snapshot of the save file has earned each one.
 *
 * No store access and no side effects: `progressStore` builds the stats object
 * and persists whatever `earned()` returns. That keeps the rules testable
 * without localStorage and keeps unlocking idempotent (an id already in the save
 * file is never re-evaluated).
 */

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface AchievementDef {
  id: string;
  name: string;
  /** how it is earned, shown in the list */
  desc: string;
  tier: AchievementTier;
  /** short progress hint, e.g. "12/60" */
  progressKey?: 'levels' | 'stars' | 'challenges' | 'concedes' | 'streak';
}

export interface AchievementStats {
  /** campaign levels cleared (any star count) */
  clearedLevels: number;
  totalLevels: number;
  /** campaign levels at three stars */
  threeStarLevels: number;
  /** challenge levels the player cleared *by themselves* */
  challengeCleared: number;
  /** challenge levels passed at all (cleared or conceded) */
  challengePassed: number;
  challengeTotal: number;
  /** challenge levels where the player conceded (unique levels) */
  challengeConceded: number;
  /** current and best streak of self-clears without conceding */
  challengeStreak: number;
  bestChallengeStreak: number;
}

interface Rule {
  def: AchievementDef;
  rule: (s: AchievementStats) => boolean;
}

const RULES: Rule[] = [
  {
    def: {
      id: 'first_clear',
      name: '首滴入账',
      desc: '第一次把水送进排水口，合同盖章。',
      tier: 'bronze',
      progressKey: 'levels',
    },
    rule: (s) => s.clearedLevels >= 1,
  },
  {
    def: {
      id: 'three_star',
      name: '三钻工程师',
      desc: '第一次在合同里拿到三星。',
      tier: 'bronze',
      progressKey: 'stars',
    },
    rule: (s) => s.threeStarLevels >= 1,
  },
  {
    def: {
      id: 'star_collector',
      name: '星图收藏家',
      desc: '累计 30 关三星。',
      tier: 'silver',
      progressKey: 'stars',
    },
    rule: (s) => s.threeStarLevels >= 30,
  },
  {
    def: {
      id: 'star_perfect',
      name: '全星水厂',
      desc: '全部 60 关三星通关。',
      tier: 'gold',
      progressKey: 'stars',
    },
    rule: (s) => s.totalLevels > 0 && s.threeStarLevels >= s.totalLevels,
  },
  {
    def: {
      id: 'challenge_first',
      name: '迎难而上',
      desc: '不认输，靠自己通过第一个挑战关。',
      tier: 'bronze',
      progressKey: 'challenges',
    },
    rule: (s) => s.challengeCleared >= 1,
  },
  {
    def: {
      id: 'challenge_ten',
      name: '挑战者',
      desc: '靠自己通过 10 个挑战关。',
      tier: 'silver',
      progressKey: 'challenges',
    },
    rule: (s) => s.challengeCleared >= 10,
  },
  {
    def: {
      id: 'challenge_thirty',
      name: '半程铁人',
      desc: '靠自己通过 30 个挑战关。',
      tier: 'gold',
      progressKey: 'challenges',
    },
    rule: (s) => s.challengeCleared >= 30,
  },
  {
    def: {
      id: 'challenge_all',
      name: '满分执念',
      desc: '靠自己通过全部 60 个挑战关。',
      tier: 'gold',
      progressKey: 'challenges',
    },
    rule: (s) => s.challengeTotal > 0 && s.challengeCleared >= s.challengeTotal,
  },
  {
    def: {
      id: 'concede_first',
      name: '认输也是本事',
      desc: '第一次认输，收下官方回放码。',
      tier: 'bronze',
      progressKey: 'concedes',
    },
    rule: (s) => s.challengeConceded >= 1,
  },
  {
    def: {
      id: 'streak_ten',
      name: '十连不认输',
      desc: '连续 10 个挑战关靠自己通过，中间不认输。',
      tier: 'silver',
      progressKey: 'streak',
    },
    rule: (s) => s.bestChallengeStreak >= 10,
  },
  {
    def: {
      id: 'challenge_few',
      name: '三顾茅庐',
      desc: '全部挑战关通过，且认输不超过 3 次。',
      tier: 'platinum',
      progressKey: 'concedes',
    },
    rule: (s) =>
      s.challengeTotal > 0 && s.challengePassed >= s.challengeTotal && s.challengeConceded <= 3,
  },
  {
    def: {
      id: 'challenge_pure',
      name: '白璧无瑕',
      desc: '全部挑战关通过，一次都没认输。',
      tier: 'platinum',
      progressKey: 'concedes',
    },
    rule: (s) =>
      s.challengeTotal > 0 && s.challengePassed >= s.challengeTotal && s.challengeConceded === 0,
  },
];

export const ACHIEVEMENTS: readonly AchievementDef[] = RULES.map((r) => r.def);

const RULE_BY_ID = new Map(RULES.map((r) => [r.def.id, r.rule]));

/** Ids the save file has earned. Pure and order-stable. */
export function earned(stats: AchievementStats): string[] {
  const out: string[] = [];
  for (const [id, rule] of RULE_BY_ID) {
    if (rule(stats)) out.push(id);
  }
  return out;
}

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Progress text for one achievement, e.g. "12/60". Null when not countable. */
export function achievementProgress(id: string, s: AchievementStats): string | null {
  const def = achievementById(id);
  if (!def?.progressKey) return null;
  switch (def.progressKey) {
    case 'levels':
      return `${s.clearedLevels}/${s.totalLevels}`;
    case 'stars':
      return `${s.threeStarLevels}/${s.totalLevels}`;
    case 'challenges':
      return `${s.challengeCleared}/${s.challengeTotal}`;
    case 'concedes':
      return `认输 ${s.challengeConceded} 次 · 通过 ${s.challengePassed}/${s.challengeTotal}`;
    case 'streak':
      return `当前 ${s.challengeStreak} · 最佳 ${s.bestChallengeStreak}`;
    default:
      return null;
  }
}
