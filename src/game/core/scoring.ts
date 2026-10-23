/**
 * Scoring, stars and goal evaluation. Pure functions only.
 */

import { POLLUTION_LIMIT, SCORE_CLEAN_DRAIN, SCORE_CLEAN_WASTED, SCORE_DIRTY_DRAIN } from './constants';
import type { GoalProgress, Ledger, LevelDefinition, LevelGoal } from './types';

export function drainScore(ledger: Ledger): number {
  // Clean water that went into a dirty drain must not earn the clean-drain
  // rate; it is subtracted here and penalised separately.
  const cleanToCleanDrain = Math.max(0, ledger.drainedClean - ledger.wasted);
  return (
    cleanToCleanDrain * SCORE_CLEAN_DRAIN +
    ledger.drainedDirty * SCORE_DIRTY_DRAIN +
    ledger.wasted * SCORE_CLEAN_WASTED
  );
}

export function blockBonus(blocksUsed: number, blockLimit: number): number {
  return Math.max(0, blockLimit - blocksUsed) * 15;
}

export function finalScore(ledger: Ledger, blocksUsed: number, blockLimit: number, won: boolean): number {
  const base = drainScore(ledger);
  const bonus = won ? blockBonus(blocksUsed, blockLimit) : 0;
  return Math.max(0, Math.round(base + bonus));
}

export function goalLabel(goal: LevelGoal, drains: LevelDefinition['drains']): string {
  const drainName = (id?: number): string => {
    if (id === undefined || id < 0) return '任意';
    const d = drains.find((x) => x.id === id);
    if (!d) return `#${id}`;
    return `${id === 0 ? 'A' : id === 1 ? 'B' : id === 2 ? 'C' : String.fromCharCode(65 + id)} 口`;
  };
  switch (goal.type) {
    case 'drainClean':
      return `向 ${drainName(goal.drainId)} 排出 ${goal.amount ?? 0} 单位清水`;
    case 'drainDirty':
      return `向 ${drainName(goal.drainId)} 排出 ${goal.amount ?? 0} 单位污水`;
    case 'waterline':
      return `水位不高于第 ${(goal.row ?? 0) + 1} 行`;
    case 'score':
      return `得分达到 ${goal.value ?? 0}`;
    case 'survive':
      return `坚持 ${goal.value ?? 0} 个回合`;
    default:
      return '未知目标';
  }
}

export interface GoalContext {
  drainClean: number[];
  drainDirty: number[];
  ledger: Ledger;
  waterline: number;
  score: number;
  tick: number;
}

export function evaluateGoal(goal: LevelGoal, ctx: GoalContext): { done: boolean; current: number; target: number } {
  switch (goal.type) {
    case 'drainClean': {
      const current = goal.drainId === undefined || goal.drainId < 0
        ? ctx.drainClean.reduce((a, b) => a + b, 0)
        : ctx.drainClean[goal.drainId] ?? 0;
      const target = goal.amount ?? 0;
      return { done: current + 1e-6 >= target, current, target };
    }
    case 'drainDirty': {
      const current = goal.drainId === undefined || goal.drainId < 0
        ? ctx.drainDirty.reduce((a, b) => a + b, 0)
        : ctx.drainDirty[goal.drainId] ?? 0;
      const target = goal.amount ?? 0;
      return { done: current + 1e-6 >= target, current, target };
    }
    case 'waterline': {
      const row = goal.row ?? 0;
      // waterline is the topmost wet row; smaller is safer.
      return { done: ctx.waterline >= row, current: ctx.waterline, target: row };
    }
    case 'score':
      return { done: ctx.score >= (goal.value ?? 0), current: ctx.score, target: goal.value ?? 0 };
    case 'survive': {
      const target = goal.value ?? 0;
      return { done: ctx.tick >= target, current: ctx.tick, target };
    }
    default:
      return { done: false, current: 0, target: 0 };
  }
}

export function evaluateGoals(level: LevelDefinition, ctx: GoalContext): GoalProgress[] {
  return level.goals.map((goal) => {
    const res = evaluateGoal(goal, ctx);
    return {
      goal,
      done: res.done,
      current: res.current,
      target: res.target,
      label: goalLabel(goal, level.drains),
    };
  });
}

export function allGoalsDone(progress: GoalProgress[]): boolean {
  return progress.length > 0 && progress.every((g) => g.done);
}

/** 1 star = goal, 2 = no overflow, 3 = blocks used within par. */
export function computeStars(won: boolean, overflowed: boolean, blocksUsed: number, star3Blocks: number): number {
  if (!won) return 0;
  let stars = 1;
  if (!overflowed) stars = 2;
  if (!overflowed && blocksUsed <= star3Blocks) stars = 3;
  return stars;
}

export function pollutionRatio(pollution: number): number {
  return Math.min(1, pollution / POLLUTION_LIMIT);
}

export interface FailureInfo {
  lost: boolean;
  reason: string;
  column?: number;
}

export function describeFailure(kind: 'overflow' | 'pollution' | 'blockedDrain' | 'noSpace' | 'outOfBlocks', col?: number): FailureInfo {
  switch (kind) {
    case 'overflow':
      return { lost: true, reason: `第 ${(col ?? 0) + 1} 列溢出，水漫过安全线`, column: col };
    case 'pollution':
      return { lost: true, reason: '污水进清水口第 3 次，整座水厂拒绝接收' };
    case 'blockedDrain':
      return { lost: true, reason: '关键排水口被沙土彻底堵死' };
    case 'noSpace':
      return { lost: true, reason: '新块无空间：井道顶部已经被堵满' };
    case 'outOfBlocks':
      return { lost: true, reason: '块数用尽，排水目标仍未达成' };
  }
}
