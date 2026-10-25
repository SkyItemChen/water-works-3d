/**
 * Core shared types for Waterworks 3D.
 *
 * Coordinate system:
 *   x: 0 .. cols-1  (left -> right)
 *   y: 0 .. rows-1  (top -> bottom)
 *   cell index: y * cols + x
 */

export type MaterialId = number;

export const MAT = {
  Empty: 0,
  Soil: 1,
  Sand: 2,
  Sponge: 3,
  Pipe: 4,
  Valve: 5,
  Filter: 6,
  DrainClean: 7,
  DrainDirty: 8,
  Ice: 9,
} as const;

export type MaterialName =
  | 'empty'
  | 'soil'
  | 'sand'
  | 'sponge'
  | 'pipe'
  | 'valve'
  | 'filter'
  | 'drainClean'
  | 'drainDirty'
  | 'ice';

export const MATERIAL_NAMES: Record<number, MaterialName> = {
  0: 'empty',
  1: 'soil',
  2: 'sand',
  3: 'sponge',
  4: 'pipe',
  5: 'valve',
  6: 'filter',
  7: 'drainClean',
  8: 'drainDirty',
  9: 'ice',
};

export const MATERIAL_FROM_NAME: Record<MaterialName, MaterialId> = {
  empty: MAT.Empty,
  soil: MAT.Soil,
  sand: MAT.Sand,
  sponge: MAT.Sponge,
  pipe: MAT.Pipe,
  valve: MAT.Valve,
  filter: MAT.Filter,
  drainClean: MAT.DrainClean,
  drainDirty: MAT.DrainDirty,
  ice: MAT.Ice,
};

/** 0 up, 1 right, 2 down, 3 left */
export type Dir = 0 | 1 | 2 | 3;
export const DIR_DX: readonly number[] = [0, 1, 0, -1];
export const DIR_DY: readonly number[] = [-1, 0, 1, 0];

export type DrainKind = 'clean' | 'dirty';
export type GameMode = 'contract' | 'daily' | 'endless' | 'replay' | 'editor';
export type GameStatus = 'playing' | 'won' | 'lost' | 'replay';

export interface CellMeta {
  /** pipe / valve orientation */
  dir: Dir;
  /** sponge water held, 0..2 (clean + dirty) */
  absorbClean: number;
  absorbDirty: number;
  /** filter saturation, 0..3 */
  clog: number;
  /** soil crack flag */
  cracked: boolean;
  /** drain identity (-1 when not a drain) */
  drainId: number;
  /** orientation lock for level furniture */
  fixed: boolean;
}

export function createMeta(): CellMeta {
  return {
    dir: 2,
    absorbClean: 0,
    absorbDirty: 0,
    clog: 0,
    cracked: false,
    drainId: -1,
    fixed: false,
  };
}

export type SimEventType =
  | 'drain'
  | 'mix'
  | 'sandCollapse'
  | 'soilCrack'
  | 'pipeBurst'
  | 'overflow'
  | 'filterClog'
  | 'pressureBurst'
  | 'spongeAbsorb'
  | 'spongeRelease'
  | 'rain';

export interface SimEvent {
  type: SimEventType;
  cell: number;
  x: number;
  y: number;
  amount: number;
  clean?: number;
  dirty?: number;
  dir?: Dir;
  reason?: string;
}

/**
 * One hard drop, kept purely for rendering.
 *
 * A hard drop is instantaneous in the rules: the piece teleports to its landing
 * row and locks on the same tick. That is correct for the simulation but reads
 * as a glitch on screen, so the renderer draws a fast fall between `fromY` and
 * `toY` on top of the already-locked block. Nothing here feeds back into the
 * simulation and nothing here is hashed.
 */
export interface HardDropFx {
  /** tick the drop was issued on */
  t: number;
  /** piece origin column when the drop was issued */
  x: number;
  /** origin row before the drop */
  fromY: number;
  /** origin row the piece landed on */
  toY: number;
  /** piece footprint, unrotated offsets of the landed piece */
  cells: BlockCell[];
  color: string;
  /**
   * Piece kind and conduit direction, so the renderer can draw the direction
   * arrow on the flying slam too. Without these the arrow vanished for the
   * whole drop, even though the block that landed immediately shows one.
   */
  kind: BlockKind;
  dir?: Dir;
}

export interface DrainDef {
  id: number;
  x: number;
  y: number;
  kind: DrainKind;
}

export type BlockKind =
  | 'soil2'
  | 'soilL'
  | 'pocket'
  | 'pocketDirty'
  | 'sponge'
  | 'pipe'
  | 'sand'
  | 'valve'
  | 'filter'
  | 'ice';

export interface BlockCell {
  x: number;
  y: number;
}

export interface BlockDef {
  kind: BlockKind;
  name: string;
  material: MaterialId;
  /** footprint offsets before rotation */
  cells: BlockCell[];
  width: number;
  height: number;
  /** pipe/valve default direction before rotation */
  dir?: Dir;
  /** water pocket volume in units */
  volume?: number;
  dirty?: boolean;
  rotatable: boolean;
  color: string;
}

export type GoalType = 'drainClean' | 'drainDirty' | 'waterline' | 'score' | 'survive';

export interface LevelGoal {
  type: GoalType;
  /** drain id for drain goals; -1 or omitted = any clean/dirty drain */
  drainId?: number;
  /** required amount for drain goals */
  amount?: number;
  /** waterline: no water above this row (0-based, top = 0) */
  row?: number;
  /** score target */
  value?: number;
}

export interface LevelTerrain {
  x: number;
  y: number;
  m: MaterialName;
  dir?: Dir;
  absorb?: number;
  clog?: number;
}

export interface LevelWater {
  x: number;
  y: number;
  clean?: number;
  dirty?: number;
}

export interface LevelDefinition {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  mechanic: string;
  intro: string;
  seed: number;
  cols: number;
  rows: number;
  drains: DrainDef[];
  terrain: LevelTerrain[];
  initialWater?: LevelWater[];
  pool: BlockKind[];
  blockLimit: number;
  fallInterval: number;
  goals: LevelGoal[];
  star3Blocks: number;
  /** optional: endless difficulty config */
  endless?: boolean;
  /**
   * Optional tutorial metadata. Present only on levels loaded from
   * tutorial.json; contract levels never carry it. Purely descriptive data —
   * the engine ignores it, so it cannot influence simulation or hashes.
   */
  tutorial?: TutorialStepData;
}

/* --- Tutorial (descriptive metadata + pure predicates) --------------------- */

/** Where the tutorial overlay should point the player's attention. */
export interface TutorialHighlight {
  /** 0-based column indices */
  columns?: number[];
  /** 0-based cell coordinates */
  cells?: { x: number; y: number }[];
  /** HUD region ids, e.g. "hud.goals" / "hud.ledger" */
  hud?: string[];
}

/**
 * A predicate over one discrete engine observation. Deliberately tiny and
 * data-only so it can live in JSON and be unit tested without an engine.
 */
export type TutorialCondition =
  | { kind: 'lockKind'; anyOf: readonly BlockKind[] }
  | { kind: 'drainedCleanAtLeast'; amount: number }
  | { kind: 'drainedDirtyAtLeast'; amount: number }
  | { kind: 'mixed' }
  | { kind: 'all'; of: readonly TutorialCondition[] };

export interface TutorialStepData {
  stepId: string;
  title: string;
  goalText: string;
  hint?: string;
  condition: TutorialCondition;
  highlight: TutorialHighlight;
}

/**
 * One discrete observation of the engine, fed to the tutorial predicates.
 * Derived from engine fields the store already publishes — never written back.
 */
export interface TutorialObservation {
  /** kind of the piece that just locked, or null */
  lockKind: BlockKind | null;
  /** cumulative clean water drained */
  drainedClean: number;
  /** cumulative dirty water drained */
  drainedDirty: number;
  /** a clean/dirty mix happened since the previous observation */
  mixed: boolean;
}

/** Tutorial progress. Lives outside the engine; never hashed, never shared. */
export interface TutorialState {
  stepIndex: number;
  totalSteps: number;
  done: boolean;
  skipped: boolean;
}

export interface Ledger {
  /** total water that entered the field (pocket bursts, rain, initial) */
  injected: number;
  drainedClean: number;
  drainedDirty: number;
  /** water currently in the field, including sponge-held water */
  inField: number;
  overflowed: number;
  /** dirty water that entered a clean drain */
  pollution: number;
  /** clean water that entered a dirty drain */
  wasted: number;
  absorbed: number;
}

export function emptyLedger(): Ledger {
  return {
    injected: 0,
    drainedClean: 0,
    drainedDirty: 0,
    inField: 0,
    overflowed: 0,
    pollution: 0,
    wasted: 0,
    absorbed: 0,
  };
}

export interface WaterField {
  clean: Float64Array;
  dirty: Float64Array;
}

export interface SimConfig {
  cols: number;
  rows: number;
  /** pressure multiplier, default 1 */
  pressureScale?: number;
  /** allow soil / pipe breaking, default true */
  destruction?: boolean;
}

export interface SimResult {
  water: WaterField;
  pressure: Float64Array;
  grid: Uint8Array;
  meta: CellMeta[];
  events: SimEvent[];
  overflowed: number;
  drainedClean: number;
  drainedDirty: number;
  pollution: number;
  wasted: number;
  filterClogs: number;
  drainClean: number[];
  drainDirty: number[];
}

export interface ReplayOp {
  /** engine tick at which the op was executed */
  t: number;
  /** L | R | C | A | D | H | S */
  a: 'L' | 'R' | 'C' | 'A' | 'D' | 'H' | 'S';
}

/**
 * One locked piece in a compact replay. Replaying only needs the tick, the
 * final column, the rotation and whether a hold swap preceded it, because the
 * water simulation is a pure function of the tick count.
 */
export interface Placement {
  /** tick at which the piece locked (== the tick it must be injected on) */
  t: number;
  /** final column of the piece origin */
  x: number;
  /** rotation count 0..3 */
  r: number;
  /** hold swap performed before this placement */
  h: boolean;
  /**
   * How the piece was released. Soft drop and natural gravity are NOT the same
   * speed (a soft-drop press advances one row instantly and resets the fall
   * timer, while gravity needs `max(4, fallInterval)` ticks per row), so the
   * two are recorded separately even though both converge on the lock tick.
   */
  drop?: 'hard' | 'soft';
}

export interface ReplayPayload {
  v: 1;
  /** level id */
  l: string;
  /** run seed (mixed with level seed) */
  s: number;
  /** operation stream (fine-grained; kept for tests and legacy codes) */
  o: ReplayOp[];
  /** compact per-piece placements, used by share codes */
  pl?: Placement[];
  /** final score for display */
  c: number;
  /** state hash to verify determinism */
  h?: string;
  /** result */
  r?: 'won' | 'lost';
  /** total simulated ticks at the end of the run (for exact replay) */
  tt?: number;
  /** creation timestamp (informational only) */
  at?: number;
}

export interface ShareHistoryEntry {
  code: string;
  levelId: string;
  levelName: string;
  score: number;
  won: boolean;
  date: number;
}

export interface DailyRecord {
  date: string;
  bestScore: number;
  bestBlocks: number;
  plays: number;
  history: { score: number; blocks: number; won: boolean; at: number }[];
}

export interface RunResult {
  won: boolean;
  reason: string;
  score: number;
  stars: number;
  ledger: Ledger;
  blocksUsed: number;
  goals: GoalProgress[];
  hash: string;
  ops: ReplayOp[];
  seed: number;
  durationTicks: number;
}

export interface GoalProgress {
  goal: LevelGoal;
  done: boolean;
  current: number;
  target: number;
  label: string;
}

export interface BlockPiece {
  kind: BlockKind;
  cells: BlockCell[];
  width: number;
  height: number;
  material: MaterialId;
  dir: Dir;
  volume: number;
  dirty: boolean;
  color: string;
  rotation: number;
}

export interface EngineSnapshot {
  cols: number;
  rows: number;
  tick: number;
  grid: Uint8Array;
  clean: Float64Array;
  dirty: Float64Array;
  pressure: Float64Array;
  meta: CellMeta[];
  piece: {
    kind: BlockKind;
    cells: BlockCell[];
    x: number;
    y: number;
    color: string;
    material: MaterialId;
    /** pipe/valve direction (0 up, 1 right, 2 down, 3 left) */
    dir: number;
  } | null;
  ghostY: number;
  next: BlockKind[];
  hold: BlockKind | null;
  holdUsed: boolean;
  score: number;
  blocksUsed: number;
  blockLimit: number;
  status: GameStatus;
  ledger: Ledger;
  goals: GoalProgress[];
  dangerCols: number[];
  waterline: number;
  pollutionStrikes: number;
  seed: number;
  mode: GameMode;
  levelId: string;
  levelName: string;
  mixCells: number[];
  prefillPreview: SimPreview;
}

export interface SimPreview {
  clean: Float64Array;
  dirty: Float64Array;
  steps: number;
  /** highest water row per column after preview */
  topRow: number[];
}
