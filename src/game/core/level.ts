/**
 * Level catalogue loading + level factory helpers.
 * Level data lives in src/levels/levels.json so contracts can be authored
 * without touching code; the schema supports up to 60 contracts.
 */

import rawLevels from '../../levels/levels.json';
import rawTutorial from '../../levels/tutorial.json';
import { MAT, MATERIAL_FROM_NAME, type BlockCell, type BlockKind, type LevelDefinition, type LevelTerrain } from './types';
import { DEFAULT_COLS, DEFAULT_ROWS } from './constants';

const DEFINITIONS = rawLevels as unknown as LevelDefinition[];
const TUTORIAL_DEFINITIONS = rawTutorial as unknown as LevelDefinition[];

function hydrate(l: LevelDefinition): LevelDefinition {
  return {
    ...l,
    cols: l.cols || DEFAULT_COLS,
    rows: l.rows || DEFAULT_ROWS,
    drains: l.drains.map((d) => ({ ...d })),
    terrain: l.terrain.map((t) => ({ ...t })),
    goals: l.goals.map((g) => ({ ...g })),
    pool: [...l.pool],
    tutorial: l.tutorial ? { ...l.tutorial } : undefined,
  };
}

export function allLevels(): LevelDefinition[] {
  return DEFINITIONS.map(hydrate);
}

/**
 * Tutorial levels. Same schema as contracts — the engine treats them as normal
 * levels, which is exactly the point: no special-case branches anywhere.
 */
export function tutorialLevels(): LevelDefinition[] {
  return TUTORIAL_DEFINITIONS.map(hydrate);
}

export function firstTutorialLevel(): LevelDefinition | undefined {
  return tutorialLevels()[0];
}

export function contractLevels(): LevelDefinition[] {
  return allLevels().filter((l) => !l.endless);
}

export function levelById(id: string): LevelDefinition | undefined {
  return allLevels().find((l) => l.id === id) ?? tutorialLevels().find((l) => l.id === id);
}

export function isTutorialLevelId(id: string): boolean {
  return TUTORIAL_DEFINITIONS.some((l) => l.id === id);
}

export function levelByIndex(index: number): LevelDefinition | undefined {
  return contractLevels().find((l) => l.index === index);
}

/** Endless mode uses the last contract's geometry with an endless pool. */
export function endlessLevel(seed: number): LevelDefinition {
  // Two-clean-drain geometry gives the player a fighting chance as the
  // waterline creeps up.
  const base = contractLevels()[9];
  return {
    ...base,
    id: 'endless',
    index: 999,
    name: '无尽水厂',
    subtitle: '无尽模式 · 水位持续上涨',
    intro: '水位会随时间上涨。尽可能多地排水，直到水漫过安全线。',
    seed,
    blockLimit: 9999,
    fallInterval: 20,
    pool: ['pocket', 'pocketDirty', 'filter', 'pipe', 'valve', 'sponge', 'soil2', 'sand', 'ice', 'soilL'],
    goals: [],
    star3Blocks: 0,
    endless: true,
  };
}

/** Validate a level definition (used by the editor preview + tests). */
export function validateLevel(level: LevelDefinition): string[] {
  const errors: string[] = [];
  if (level.cols < 4 || level.cols > 40) errors.push('cols out of range');
  if (level.rows < 6 || level.rows > 60) errors.push('rows out of range');
  if (level.pool.length === 0) errors.push('pool is empty');
  if (level.blockLimit < 1) errors.push('blockLimit must be positive');
  for (const d of level.drains) {
    if (d.x < 0 || d.x >= level.cols || d.y < 0 || d.y >= level.rows) errors.push(`drain ${d.id} out of bounds`);
    if (d.y !== level.rows - 1) errors.push(`drain ${d.id} must sit on the bottom row`);
  }
  for (const t of level.terrain) {
    if (t.x < 0 || t.x >= level.cols || t.y < 0 || t.y >= level.rows) errors.push(`terrain at ${t.x},${t.y} out of bounds`);
    if (!(t.m in MATERIAL_FROM_NAME)) errors.push(`unknown material ${t.m}`);
  }
  return errors;
}

/** Bounding footprint helper shared with the editor. */
export function cellsForTerrain(t: LevelTerrain): BlockCell[] {
  return [{ x: t.x, y: t.y }];
}

export function materialOf(name: keyof typeof MATERIAL_FROM_NAME): number {
  return MATERIAL_FROM_NAME[name] ?? MAT.Empty;
}

/** Serialize a level to the compact editor JSON format (P2 hook). */
export function exportLevelJson(level: LevelDefinition): string {
  return JSON.stringify(level);
}

export function importLevelJson(json: string): LevelDefinition {
  const parsed = JSON.parse(json) as LevelDefinition;
  parsed.cols ||= DEFAULT_COLS;
  parsed.rows ||= DEFAULT_ROWS;
  parsed.pool ||= ['soil2', 'pocket', 'sponge'];
  parsed.goals ||= [];
  return parsed;
}

export interface EditorDraft {
  level: LevelDefinition;
  brush: BlockKind | 'erase' | 'drainClean' | 'drainDirty';
  dirty: boolean;
}

export function makeEmptyLevel(id: string): LevelDefinition {
  return {
    id,
    index: 0,
    name: '未命名合同',
    subtitle: '编辑器草稿',
    mechanic: '自定义',
    intro: '',
    seed: 12345,
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    drains: [{ id: 0, x: 4, y: DEFAULT_ROWS - 1, kind: 'clean' }],
    terrain: [],
    pool: ['soil2', 'pocket', 'sponge'],
    blockLimit: 20,
    fallInterval: 24,
    goals: [{ type: 'drainClean', drainId: 0, amount: 8 }],
    star3Blocks: 8,
  };
}
