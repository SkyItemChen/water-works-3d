import { describe, expect, it } from 'vitest';
import { makeEmptyLevel } from '../game/core/level';
import {
  addGoal,
  changeGoalType,
  clearCell,
  normalizeEditorLevel,
  paintDrain,
  paintInitialWater,
  paintTerrain,
  resizeLevel,
  setPoolCount,
  validateEditorLevel,
} from '../game/core/editor';

function base() {
  return makeEmptyLevel('draft-test');
}

describe('level editor operations', () => {
  it('paints terrain and keeps conduit direction', () => {
    const level = paintTerrain(base(), 2, 3, 'pipe', 1);
    const cell = level.terrain.find((t) => t.x === 2 && t.y === 3);
    expect(cell).toMatchObject({ m: 'pipe', dir: 1 });
  });

  it('only accepts drains on the bottom row', () => {
    const level = base();
    expect(paintDrain(level, 2, 4, 'clean')).toBe(level);
    const placed = paintDrain(level, 2, level.rows - 1, 'clean');
    expect(placed.drains.some((d) => d.x === 2 && d.y === level.rows - 1)).toBe(true);
  });

  it('changing a drain kind preserves its id and the goals pointing at it', () => {
    const level = base();
    const drain = level.drains[0];
    const next = paintDrain(level, drain.x, drain.y, 'dirty');
    expect(next.drains.find((d) => d.x === drain.x)?.id).toBe(drain.id);
    expect(next.drains.find((d) => d.x === drain.x)?.kind).toBe('dirty');
    expect(next.goals[0].drainId).toBe(drain.id);
  });

  it('painting terrain over a drain removes the drain and its goals', () => {
    const level = base();
    const drain = level.drains[0];
    const next = paintTerrain(level, drain.x, drain.y, 'soil');
    expect(next.drains).toHaveLength(0);
    expect(next.goals).toHaveLength(0);
  });

  it('initial water and eraser touch only their target cell', () => {
    const level = paintInitialWater(base(), 3, 4, 'dirty');
    expect(level.initialWater?.[0]).toMatchObject({ x: 3, y: 4, dirty: 1 });
    const cleared = clearCell(level, 3, 4);
    expect(cleared.initialWater).toHaveLength(0);
  });

  it('resize clamps dimensions, relocates drains to the new bottom row and trims cells', () => {
    let level = paintTerrain(base(), 9, 10, 'ice');
    level = paintDrain(level, 8, level.rows - 1, 'clean');
    const resized = resizeLevel(level, 8, 10);
    expect(resized.cols).toBe(8);
    expect(resized.rows).toBe(10);
    expect(resized.terrain).toHaveLength(0);
    expect(resized.drains.every((d) => d.y === 9 && d.x < 8)).toBe(true);
  });

  it('pool counts are weighted and removable', () => {
    let level = setPoolCount(base(), 'filter', 3);
    expect(level.pool.filter((k) => k === 'filter')).toHaveLength(3);
    level = setPoolCount(level, 'filter', 0);
    expect(level.pool).not.toContain('filter');
  });

  it('normalizes malformed imported data', () => {
    const level = normalizeEditorLevel({
      id: 'draft-import',
      cols: 999,
      rows: 2,
      drains: [{ id: 0, x: 200, y: 0, kind: 'clean' }],
      terrain: [{ x: -1, y: 0, m: 'lava' as never }],
      goals: [{ type: 'drainClean', drainId: 9, amount: 0 }],
      pool: ['not-a-block' as never],
    });
    expect(level.cols).toBe(40);
    expect(level.rows).toBe(6);
    expect(level.terrain).toHaveLength(0);
    expect(level.drains[0].x).toBe(39);
    expect(level.drains[0].y).toBe(5);
  });

  it('goal type changes clear fields that no longer apply', () => {
    const level = changeGoalType(base(), 0, 'score');
    expect(level.goals[0]).toEqual({ type: 'score', value: 100 });
    const added = addGoal(level);
    expect(added.goals).toHaveLength(2);
  });

  it('validation catches missing goals, duplicate terrain and bad targets', () => {
    const level = base();
    level.goals = [];
    level.terrain.push({ x: 0, y: 0, m: 'soil' }, { x: 0, y: 0, m: 'soil' });
    const errors = validateEditorLevel(level);
    expect(errors.some((e) => e.includes('至少设置一个通关目标'))).toBe(true);
    expect(errors.some((e) => e.includes('重复'))).toBe(true);
  });
});
