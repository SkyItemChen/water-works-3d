/**
 * Level-editor operations.
 *
 * Pure, framework-free helpers used by LevelEditor.vue. Each function returns a
 * new LevelDefinition, so Vue can treat the draft as immutable data and tests
 * can assert exactly what a paint / resize / goal change did.
 */

import { ALL_BLOCK_KINDS } from './bag';
import { DEFAULT_COLS, DEFAULT_ROWS } from './constants';
import type {
  BlockKind,
  DrainDef,
  DrainKind,
  Dir,
  GoalType,
  LevelDefinition,
  LevelGoal,
  LevelTerrain,
  LevelWater,
  MaterialName,
} from './types';

export const EDITOR_MIN_COLS = 4;
export const EDITOR_MAX_COLS = 40;
export const EDITOR_MIN_ROWS = 6;
export const EDITOR_MAX_ROWS = 60;

export type EditorTerrainMaterial = Extract<MaterialName, 'soil' | 'sand' | 'sponge' | 'pipe' | 'valve' | 'filter' | 'ice'>;
export type EditorBrushId = EditorTerrainMaterial | 'drainClean' | 'drainDirty' | 'waterClean' | 'waterDirty' | 'erase';

export interface EditorBrush {
  id: EditorBrushId;
  label: string;
  group: 'terrain' | 'marker';
  color: string;
}

export const EDITOR_BRUSHES: readonly EditorBrush[] = [
  { id: 'soil', label: '土壤', group: 'terrain', color: '#8a5a3b' },
  { id: 'sand', label: '沙块', group: 'terrain', color: '#d8bd83' },
  { id: 'sponge', label: '海绵', group: 'terrain', color: '#f2b6c6' },
  { id: 'pipe', label: '管道', group: 'terrain', color: '#9aa7b4' },
  { id: 'valve', label: '单向阀', group: 'terrain', color: '#ffc857' },
  { id: 'filter', label: '过滤器', group: 'terrain', color: '#a8e6cf' },
  { id: 'ice', label: '冰块', group: 'terrain', color: '#bfeaff' },
  { id: 'drainClean', label: '清水口', group: 'marker', color: '#35d0a0' },
  { id: 'drainDirty', label: '污水口', group: 'marker', color: '#c06b3f' },
  { id: 'waterClean', label: '初始清水', group: 'marker', color: '#39c5ff' },
  { id: 'waterDirty', label: '初始污水', group: 'marker', color: '#6f7a33' },
  { id: 'erase', label: '橡皮擦', group: 'marker', color: '#596a78' },
];

export const EDITOR_BLOCK_KINDS: readonly BlockKind[] = ALL_BLOCK_KINDS;

const TERRAIN_MATERIALS = new Set<MaterialName>(['soil', 'sand', 'sponge', 'pipe', 'valve', 'filter', 'ice']);
const GOAL_TYPES: readonly GoalType[] = ['drainClean', 'drainDirty', 'waterline', 'score', 'survive'];

export const DIRECTION_LABELS: readonly string[] = ['上', '右', '下', '左'];

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

export function cloneLevel(level: LevelDefinition): LevelDefinition {
  return {
    ...level,
    drains: level.drains.map((d) => ({ ...d })),
    terrain: level.terrain.map((t) => ({ ...t })),
    goals: level.goals.map((g) => ({ ...g })),
    pool: [...level.pool],
    initialWater: level.initialWater?.map((w) => ({ ...w })),
    tutorial: level.tutorial ? { ...level.tutorial } : undefined,
  };
}

/** Repair partial / imported JSON into the shape the engine expects. */
export function normalizeEditorLevel(raw: Partial<LevelDefinition> | null | undefined): LevelDefinition {
  const src = raw ?? {};
  const cols = clampInt(src.cols ?? DEFAULT_COLS, EDITOR_MIN_COLS, EDITOR_MAX_COLS, DEFAULT_COLS);
  const rows = clampInt(src.rows ?? DEFAULT_ROWS, EDITOR_MIN_ROWS, EDITOR_MAX_ROWS, DEFAULT_ROWS);

  const usedIds = new Set<number>();
  let nextId = 0;
  const drains: DrainDef[] = [];
  for (const d of Array.isArray(src.drains) ? src.drains : []) {
    const x = clampInt(d?.x ?? 0, 0, cols - 1, 0);
    if (drains.some((other) => other.x === x && other.y === rows - 1)) continue;
    let id = Number.isFinite(d?.id) ? Math.trunc(d!.id) : nextId;
    if (id < 0 || usedIds.has(id)) {
      while (usedIds.has(nextId)) nextId++;
      id = nextId;
    }
    usedIds.add(id);
    drains.push({ id, x, y: rows - 1, kind: d?.kind === 'dirty' ? 'dirty' : 'clean' });
  }
  drains.sort((a, b) => a.x - b.x);

  const terrain: LevelTerrain[] = [];
  const terrainAt = new Set<string>();
  for (const t of Array.isArray(src.terrain) ? src.terrain : []) {
    const x = Math.trunc(t?.x ?? -1);
    const y = Math.trunc(t?.y ?? -1);
    const key = `${x},${y}`;
    if (x < 0 || x >= cols || y < 0 || y >= rows || !TERRAIN_MATERIALS.has(t?.m as MaterialName) || terrainAt.has(key)) continue;
    terrainAt.add(key);
    terrain.push({ x, y, m: t.m, dir: t.dir, absorb: t.absorb, clog: t.clog });
  }

  const initialWater: LevelWater[] = [];
  const waterAt = new Set<string>();
  for (const w of Array.isArray(src.initialWater) ? src.initialWater : []) {
    const x = Math.trunc(w?.x ?? -1);
    const y = Math.trunc(w?.y ?? -1);
    const key = `${x},${y}`;
    if (x < 0 || x >= cols || y < 0 || y >= rows || waterAt.has(key)) continue;
    const clean = Math.max(0, Number(w?.clean ?? 0));
    const dirty = Math.max(0, Number(w?.dirty ?? 0));
    if (clean === 0 && dirty === 0) continue;
    waterAt.add(key);
    initialWater.push({ x, y, clean, dirty });
  }

  const allowedDrainIds = new Set(drains.map((d) => d.id));
  const goals: LevelGoal[] = [];
  for (const g of Array.isArray(src.goals) ? src.goals : []) {
    if (!GOAL_TYPES.includes(g?.type as GoalType)) continue;
    const goal: LevelGoal = { type: g.type as GoalType };
    if (goal.type === 'drainClean' || goal.type === 'drainDirty') {
      goal.drainId = Number.isFinite(g.drainId) ? Math.trunc(g.drainId!) : -1;
      goal.amount = Math.max(0, Number(g.amount ?? 0));
      if (goal.drainId !== -1 && !allowedDrainIds.has(goal.drainId)) delete goal.drainId;
    } else if (goal.type === 'waterline') {
      goal.row = clampInt(Number(g.row ?? rows - 1), 0, rows - 1, rows - 1);
    } else if (goal.type === 'score') {
      goal.value = Math.max(0, Number(g.value ?? 0));
    }
    goals.push(goal);
  }

  const pool = (Array.isArray(src.pool) ? src.pool : []).filter((k): k is BlockKind =>
    ALL_BLOCK_KINDS.includes(k as BlockKind),
  );

  return {
    id: (src.id || 'draft-1').trim() || 'draft-1',
    index: Math.max(0, Math.trunc(Number(src.index ?? 0))),
    name: (src.name || '未命名合同').trim() || '未命名合同',
    subtitle: src.subtitle ?? '编辑器草稿',
    mechanic: src.mechanic ?? '自定义',
    intro: src.intro ?? '',
    seed: Number.isFinite(src.seed) ? Math.trunc(src.seed!) : 12345,
    cols,
    rows,
    drains,
    terrain,
    initialWater,
    pool: pool.length ? pool : ['soil2', 'pocket', 'sponge'],
    blockLimit: Math.max(1, Math.trunc(Number(src.blockLimit ?? 20))),
    fallInterval: Math.max(1, Math.trunc(Number(src.fallInterval ?? 24))),
    goals,
    star3Blocks: Math.max(0, Math.trunc(Number(src.star3Blocks ?? 0))),
    tutorial: src.tutorial ? { ...src.tutorial } : undefined,
  };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function withoutCellMarks(level: LevelDefinition, x: number, y: number): LevelDefinition {
  const next = cloneLevel(level);
  next.terrain = next.terrain.filter((t) => t.x !== x || t.y !== y);
  next.initialWater = next.initialWater?.filter((w) => w.x !== x || w.y !== y);
  const removed = next.drains.find((d) => d.x === x && d.y === y);
  if (removed) {
    next.drains = next.drains.filter((d) => d !== removed);
    next.goals = next.goals.filter((g) => g.drainId !== removed.id);
  }
  return next;
}

export function paintTerrain(level: LevelDefinition, x: number, y: number, m: EditorTerrainMaterial, dir: Dir = 2): LevelDefinition {
  if (x < 0 || x >= level.cols || y < 0 || y >= level.rows) return level;
  const next = withoutCellMarks(level, x, y);
  const terrain: LevelTerrain = { x, y, m };
  if (m === 'pipe' || m === 'valve') terrain.dir = dir;
  next.terrain.push(terrain);
  return next;
}

/** Drain brushes only paint on the bottom row, which is where water can exit. */
export function paintDrain(level: LevelDefinition, x: number, y: number, kind: DrainKind): LevelDefinition {
  if (x < 0 || x >= level.cols || y !== level.rows - 1) return level;
  const existing = level.drains.find((d) => d.x === x && d.y === y);
  if (existing) {
    // Changing a drain's clean/dirty type must keep its id, otherwise goals
    // that point at it would silently lose their target.
    const next = cloneLevel(level);
    next.terrain = next.terrain.filter((t) => t.x !== x || t.y !== y);
    next.initialWater = next.initialWater?.filter((w) => w.x !== x || w.y !== y);
    const drain = next.drains.find((d) => d.id === existing.id)!;
    drain.kind = kind;
    return next;
  }
  const next = withoutCellMarks(level, x, y);
  const maxId = next.drains.reduce((max, d) => Math.max(max, d.id), -1);
  next.drains.push({ id: maxId + 1, x, y, kind });
  next.drains.sort((a, b) => a.x - b.x);
  return next;
}

export function paintInitialWater(level: LevelDefinition, x: number, y: number, kind: DrainKind): LevelDefinition {
  if (x < 0 || x >= level.cols || y < 0 || y >= level.rows) return level;
  const next = withoutCellMarks(level, x, y);
  const water: LevelWater = { x, y };
  if (kind === 'clean') water.clean = 1;
  else water.dirty = 1;
  next.initialWater = [...(next.initialWater ?? []), water];
  return next;
}

export function clearCell(level: LevelDefinition, x: number, y: number): LevelDefinition {
  if (x < 0 || x >= level.cols || y < 0 || y >= level.rows) return level;
  return withoutCellMarks(level, x, y);
}

export function resizeLevel(level: LevelDefinition, cols: number, rows: number): LevelDefinition {
  const nextCols = clampInt(cols, EDITOR_MIN_COLS, EDITOR_MAX_COLS, level.cols);
  const nextRows = clampInt(rows, EDITOR_MIN_ROWS, EDITOR_MAX_ROWS, level.rows);
  const next = cloneLevel(level);
  next.cols = nextCols;
  next.rows = nextRows;
  next.terrain = next.terrain.filter((t) => t.x < nextCols && t.y < nextRows);
  next.initialWater = next.initialWater?.filter((w) => w.x < nextCols && w.y < nextRows);
  next.drains = next.drains
    .filter((d) => d.x < nextCols)
    .map((d) => ({ ...d, y: nextRows - 1 }));
  const ids = new Set(next.drains.map((d) => d.id));
  next.goals = next.goals.filter((g) => g.drainId === undefined || ids.has(g.drainId));
  return next;
}

export function setPoolCount(level: LevelDefinition, kind: BlockKind, count: number): LevelDefinition {
  const next = cloneLevel(level);
  next.pool = next.pool.filter((k) => k !== kind);
  const n = Math.max(0, Math.min(9, Math.trunc(count)));
  for (let i = 0; i < n; i++) next.pool.push(kind);
  return next;
}

export function addGoal(level: LevelDefinition): LevelDefinition {
  const next = cloneLevel(level);
  const clean = next.drains.find((d) => d.kind === 'clean') ?? next.drains[0];
  next.goals.push(
    clean
      ? { type: 'drainClean', drainId: clean.id, amount: 8 }
      : { type: 'score', value: 100 },
  );
  return next;
}

export function removeGoal(level: LevelDefinition, index: number): LevelDefinition {
  const next = cloneLevel(level);
  next.goals.splice(index, 1);
  return next;
}

export function changeGoalType(level: LevelDefinition, index: number, type: GoalType): LevelDefinition {
  const next = cloneLevel(level);
  const goal = next.goals[index];
  if (!goal) return next;
  const replacement: LevelGoal = { type };
  if (type === 'drainClean' || type === 'drainDirty') {
    const match = next.drains.find((d) => (type === 'drainClean' ? d.kind === 'clean' : d.kind === 'dirty')) ?? next.drains[0];
    replacement.drainId = match?.id ?? -1;
    replacement.amount = 8;
  } else if (type === 'waterline') {
    replacement.row = Math.max(0, next.rows - 4);
  } else if (type === 'score') {
    replacement.value = 100;
  }
  next.goals[index] = replacement;
  return next;
}

export function drainLabel(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

/** Editor-facing validation with messages a level author can act on. */
export function validateEditorLevel(level: LevelDefinition): string[] {
  const errors: string[] = [];
  if (!level.name.trim()) errors.push('关卡名称不能为空');
  if (level.cols < EDITOR_MIN_COLS || level.cols > EDITOR_MAX_COLS) errors.push(`列数需在 ${EDITOR_MIN_COLS}-${EDITOR_MAX_COLS}`);
  if (level.rows < EDITOR_MIN_ROWS || level.rows > EDITOR_MAX_ROWS) errors.push(`行数需在 ${EDITOR_MIN_ROWS}-${EDITOR_MAX_ROWS}`);
  if (level.blockLimit < 1) errors.push('块数上限必须大于 0');
  if (level.star3Blocks < 0 || level.star3Blocks > level.blockLimit) errors.push('三星块数需在 0 到块数上限之间');
  if (level.pool.length === 0) errors.push('块池至少要有一种方块');
  if (!level.drains.length) errors.push('至少设置一个排水口');

  const drainPositions = new Set<string>();
  for (const d of level.drains) {
    if (d.x < 0 || d.x >= level.cols || d.y !== level.rows - 1) errors.push(`排水口 ${d.id} 必须位于最底行且不越界`);
    const key = cellKey(d.x, d.y);
    if (drainPositions.has(key)) errors.push(`排水口 ${d.id} 与另一个排水口重叠`);
    drainPositions.add(key);
  }

  if (!level.goals.length) errors.push('至少设置一个通关目标');
  for (const [i, g] of level.goals.entries()) {
    if (g.type === 'drainClean' || g.type === 'drainDirty') {
      if (g.drainId !== undefined && g.drainId !== -1 && !level.drains.some((d) => d.id === g.drainId)) {
        errors.push(`目标 ${i + 1} 指向了不存在的排水口`);
      }
      if (!g.amount || g.amount <= 0) errors.push(`目标 ${i + 1} 的排水量必须大于 0`);
    } else if (g.type === 'waterline' && (g.row === undefined || g.row < 0 || g.row >= level.rows)) {
      errors.push(`目标 ${i + 1} 的水位行越界`);
    } else if (g.type === 'score' && (!g.value || g.value <= 0)) {
      errors.push(`目标 ${i + 1} 的分数必须大于 0`);
    }
  }

  const occupied = new Set<string>();
  for (const t of level.terrain) {
    if (t.x < 0 || t.x >= level.cols || t.y < 0 || t.y >= level.rows) errors.push(`地形 ${t.x},${t.y} 越界`);
    if (!TERRAIN_MATERIALS.has(t.m)) errors.push(`未知地形材料 ${t.m}`);
    const key = cellKey(t.x, t.y);
    if (occupied.has(key)) errors.push(`地形 ${t.x + 1},${t.y + 1} 重复`);
    occupied.add(key);
  }
  for (const w of level.initialWater ?? []) {
    if (w.x < 0 || w.x >= level.cols || w.y < 0 || w.y >= level.rows) errors.push(`初始水 ${w.x},${w.y} 越界`);
  }

  return errors;
}
