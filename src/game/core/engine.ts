/**
 * Deterministic game engine: block pieces + water simulation + scoring.
 *
 * The engine is intentionally framework-free and synchronous. The Vue store
 * drives it with a fixed timestep, and the replay module re-runs it from an
 * operation stream to prove determinism.
 */

import { BLOCKS, Bag, makePiece, rotateCells } from './bag';
import {
  CELL_CAPACITY,
  LOCK_DELAY_TICKS,
  OVERFLOW_LIMIT,
  POLLUTION_LIMIT,
  WATER_EPSILON,
} from './constants';
import { previewFlow, simulate, spongeWater, type SimOptions } from './simulation';
import { allGoalsDone, computeStars, describeFailure, evaluateGoals, finalScore } from './scoring';
import {
  MATERIAL_FROM_NAME,
  MAT,
  type BlockKind,
  type BlockPiece,
  type CellMeta,
  type Dir,
  type DrainDef,
  type GameMode,
  type GameStatus,
  type GoalProgress,
  type HardDropFx,
  type Ledger,
  type LevelDefinition,
  type Placement,
  type ReplayOp,
  type SimEvent,
  type SimPreview,
} from './types';
import { hashFloats, fnv1a } from './rng';

export type Action = 'L' | 'R' | 'C' | 'A' | 'D' | 'H' | 'S';

export interface EngineOptions {
  level: LevelDefinition;
  seed?: number;
  mode?: GameMode;
  startTick?: number;
}

export interface EngineView {
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
    cells: { x: number; y: number }[];
    x: number;
    y: number;
    color: string;
    material: number;
    dir: Dir;
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
  overflowTotal: number;
  seed: number;
  mode: GameMode;
  levelId: string;
  levelName: string;
  mixture: number[];
  lastEvents: SimEvent[];
  drainClean: number[];
  drainDirty: number[];
  failureReason: string;
}

function idx(x: number, y: number, cols: number): number {
  return y * cols + x;
}

export class GameEngine {
  readonly cols: number;
  readonly rows: number;
  readonly level: LevelDefinition;
  readonly seed: number;
  readonly mode: GameMode;
  readonly drains: DrainDef[];

  grid: Uint8Array;
  clean: Float64Array;
  dirty: Float64Array;
  pressure: Float64Array;
  meta: CellMeta[];

  tick = 0;
  status: GameStatus = 'playing';
  failureReason = '';

  bag: Bag;
  piece: BlockPiece | null = null;
  pieceX = 0;
  pieceY = 0;
  next: BlockKind[] = [];
  hold: BlockKind | null = null;
  holdUsed = false;
  spawnCount = 0;

  fallTimer = 0;
  lockTimer = 0;
  grounded = false;

  score = 0;
  blocksUsed = 0;
  blockLimit: number;

  ledger: Ledger;
  drainClean: number[] = [];
  drainDirty: number[] = [];
  overflowTotal = 0;
  pollutionStrikes = 0;

  goals: GoalProgress[] = [];
  waterline = 0;
  dangerCols: number[] = [];
  mixture: number[] = [];

  ops: ReplayOp[] = [];
  /**
   * Hard drops of the current run, for the renderer only (see HardDropFx).
   * Not read by the simulation, not part of the state hash, not replayed.
   */
  hardDrops: HardDropFx[] = [];
  /** rotation count of the current piece (0..3) */
  private rot = 0;
  /** compact per-piece placement log used by share codes */
  placements: Placement[] = [];
  /** whether the current piece was swapped in via hold */
  private heldThisPiece = false;
  /**
   * How the current piece is being released, recorded with each placement.
   * This is plain recording metadata (useful for stats and replays); it is not
   * a mode switch and does not alter any rule.
   */
  private dropMode: 'hard' | 'soft' = 'soft';
  /**
   * When true the engine does not apply gravity or auto-lock, so a piece can be
   * held between placements. Used only by the compact replayer, which places
   * each recorded piece explicitly on its recorded tick; a falling piece never
   * touches water, so the simulation itself is unaffected.
   *
   * This is a *transport* switch, not a rules switch: goals, pressure, overflow
   * and the win/lose verdict all run unchanged, which is why a replay reaches
   * the same terminal state as the original run.
   */
  manualGravity = false;
  lastEvents: SimEvent[] = [];
  prefillPreview: SimPreview;

  private lastDrainClean = 0;
  private lastDrainDirty = 0;
  private lastOverflow = 0;
  private stateHash = 0;
  private endlessTimer = 0;

  constructor(opts: EngineOptions) {
    this.level = opts.level;
    this.cols = opts.level.cols;
    this.rows = opts.level.rows;
    this.seed = opts.seed ?? opts.level.seed;
    this.mode = opts.mode ?? 'contract';
    this.blockLimit = opts.level.blockLimit;
    this.drains = opts.level.drains.map((d) => ({ ...d }));

    this.grid = new Uint8Array(this.cols * this.rows);
    this.clean = new Float64Array(this.cols * this.rows);
    this.dirty = new Float64Array(this.cols * this.rows);
    this.pressure = new Float64Array(this.cols * this.rows);
    this.meta = new Array(this.cols * this.rows);
    for (let i = 0; i < this.meta.length; i++) {
      this.meta[i] = {
        dir: 2,
        absorbClean: 0,
        absorbDirty: 0,
        clog: 0,
        cracked: false,
        drainId: -1,
        fixed: true,
      };
    }
    this.ledger = {
      injected: 0,
      drainedClean: 0,
      drainedDirty: 0,
      inField: 0,
      overflowed: 0,
      pollution: 0,
      wasted: 0,
      absorbed: 0,
    };
    this.drainClean = new Array(this.drains.length).fill(0);
    this.drainDirty = new Array(this.drains.length).fill(0);

    this.loadLevel();
    this.bag = new Bag(this.level.pool, fnv1a(`${this.seed}:${this.level.id}:bag`), 7);
    this.next = [this.bag.next(), this.bag.next()];
    this.spawn();
    this.tick = opts.startTick ?? 0;
    this.recomputeDerived();
    this.prefillPreview = this.preview(3);
    this.updateGoals();
  }

  private loadLevel(): void {
    for (const t of this.level.terrain) {
      if (t.x < 0 || t.x >= this.cols || t.y < 0 || t.y >= this.rows) continue;
      const i = idx(t.x, t.y, this.cols);
      const m = MATERIAL_FROM_NAME[t.m] ?? MAT.Empty;
      this.grid[i] = m;
      const meta = this.meta[i];
      meta.dir = (t.dir ?? 2) as Dir;
      meta.absorbClean = t.absorb ?? 0;
      meta.absorbDirty = 0;
      meta.clog = t.clog ?? 0;
      meta.fixed = true;
    }
    for (const d of this.drains) {
      if (d.x < 0 || d.x >= this.cols || d.y < 0 || d.y >= this.rows) continue;
      const i = idx(d.x, d.y, this.cols);
      this.grid[i] = d.kind === 'clean' ? MAT.DrainClean : MAT.DrainDirty;
      this.meta[i].drainId = d.id;
      this.meta[i].fixed = true;
    }
    for (const w of this.level.initialWater ?? []) {
      if (w.x < 0 || w.x >= this.cols || w.y < 0 || w.y >= this.rows) continue;
      const i = idx(w.x, w.y, this.cols);
      const c = w.clean ?? 0;
      const d = w.dirty ?? 0;
      this.clean[i] = Math.min(CELL_CAPACITY, c);
      this.dirty[i] = Math.min(CELL_CAPACITY - this.clean[i], d);
      this.ledger.injected += this.clean[i] + this.dirty[i];
    }
  }

  // --- Pieces --------------------------------------------------------------

  private canPlaceCells(cells: { x: number; y: number }[], px: number, py: number): boolean {
    for (const c of cells) {
      const x = px + c.x;
      const y = py + c.y;
      if (x < 0 || x >= this.cols || y >= this.rows) return false;
      if (y < 0) continue;
      if (this.grid[idx(x, y, this.cols)] !== MAT.Empty) return false;
    }
    return true;
  }

  private spawn(): void {
    const kind = this.next.shift() ?? this.bag.next();
    this.next.push(this.bag.next());
    const piece = makePiece(kind, 0);
    let px = Math.floor((this.cols - piece.width) / 2);
    if (px < 0) px = 0;
    // Spawn so the lowest cell sits on the first row: the piece is visible
    // immediately and only its upper cells may be off-screen.
    let maxCellY = 0;
    for (const c of piece.cells) maxCellY = Math.max(maxCellY, c.y);
    const py = -maxCellY;
    // Try spawning; if blocked, nudge sideways once.
    if (!this.canPlaceCells(piece.cells, px, py)) {
      let found = false;
      for (let off = 1; off < this.cols && !found; off++) {
        for (const sign of [-1, 1]) {
          const nx = px + off * sign;
          if (this.canPlaceCells(piece.cells, nx, py)) {
            px = nx;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        this.lose('noSpace');
        this.piece = null;
        return;
      }
    }
    this.piece = piece;
    this.rot = 0;
    this.heldThisPiece = false;
    this.pieceX = px;
    this.pieceY = py;
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.grounded = false;
    this.spawnCount++;
  }

  private forEachPieceCell(cb: (x: number, y: number, j: number) => void): void {
    if (!this.piece) return;
    for (const c of this.piece.cells) {
      const x = this.pieceX + c.x;
      const y = this.pieceY + c.y;
      if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) continue;
      cb(x, y, idx(x, y, this.cols));
    }
  }

  private isGrounded(): boolean {
    if (!this.piece) return false;
    for (const c of this.piece.cells) {
      const x = this.pieceX + c.x;
      const y = this.pieceY + c.y;
      if (y < 0) continue;
      const belowY = y + 1;
      if (belowY >= this.rows) return true;
      if (x < 0 || x >= this.cols) continue;
      if (this.grid[idx(x, belowY, this.cols)] !== MAT.Empty) return true;
    }
    return false;
  }

  private tryMove(dx: number, dy: number): boolean {
    if (!this.piece || this.status !== 'playing') return false;
    if (!this.canPlaceCells(this.piece.cells, this.pieceX + dx, this.pieceY + dy)) return false;
    this.pieceX += dx;
    this.pieceY += dy;
    return true;
  }

  ghostY(): number {
    if (!this.piece) return this.pieceY;
    let y = this.pieceY;
    while (this.canPlaceCells(this.piece.cells, this.pieceX, y + 1)) y++;
    return y;
  }

  handleAction(a: Action): boolean {
    if (this.status !== 'playing') return false;
    if (!this.piece) return false;
    let applied = false;
    switch (a) {
      case 'L':
        applied = this.tryMove(-1, 0);
        break;
      case 'R':
        applied = this.tryMove(1, 0);
        break;
      case 'C': {
        if (!this.piece || !BLOCKS[this.piece.kind].rotatable) break;
        const rot = rotateCells(this.piece.cells, this.piece.width, this.piece.height);
        const piece = makePiece(this.piece.kind, this.piece.rotation + 1);
        // wall kicks: 0, -1, +1
        for (const kick of [0, -1, 1, -2, 2]) {
          if (this.canPlaceCells(piece.cells, this.pieceX + kick, this.pieceY)) {
            this.pieceX += kick;
            this.piece = piece;
            this.rot = (this.rot + 1) % 4;
            applied = true;
            break;
          }
        }
        void rot;
        break;
      }
      case 'D':
        if (this.tryMove(0, 1)) {
          applied = true;
          this.fallTimer = 0;
          this.dropMode = 'soft';
        }
        break;
      case 'A': {
        const target = this.ghostY();
        const fromY = this.pieceY;
        if (target > this.pieceY) {
          this.pieceY = target;
          applied = true;
        }
        this.dropMode = 'hard';
        // Render-only: remember the span covered in this single tick so the
        // viewport can animate the slam instead of teleporting the block.
        if (target > fromY) {
          this.hardDrops.push({
            t: this.tick,
            x: this.pieceX,
            fromY,
            toY: this.pieceY,
            cells: this.piece.cells.map((c) => ({ x: c.x, y: c.y })),
            color: this.piece.color,
            kind: this.piece.kind,
            dir: this.piece.dir,
          });
          if (this.hardDrops.length > 64) this.hardDrops.splice(0, this.hardDrops.length - 64);
        }
        this.lockPiece();
        applied = true;
        break;
      }
      case 'H': {
        if (this.holdUsed) break;
        const currentKind = this.piece.kind;
        if (this.hold === null) {
          this.hold = currentKind;
          this.piece = null;
          this.spawn();
        } else {
          const swap = this.hold;
          this.hold = currentKind;
          this.piece = makePiece(swap, 0);
          this.rot = 0;
          this.heldThisPiece = true;
          this.pieceX = Math.floor((this.cols - this.piece.width) / 2);
          this.pieceY = -this.piece.height;
          if (!this.canPlaceCells(this.piece.cells, this.pieceX, this.pieceY)) {
            this.lose('noSpace');
            this.piece = null;
          }
        }
        this.holdUsed = true;
        applied = true;
        break;
      }
      case 'S':
        break;
    }
    if (applied) this.ops.push({ t: this.tick, a });
    return applied;
  }

  private displaceWaterAt(i: number): void {
    const total = this.clean[i] + this.dirty[i];
    if (total <= WATER_EPSILON) return;
    const cRatio = this.clean[i] / total;
    this.clean[i] = 0;
    this.dirty[i] = 0;
    let remaining = total;
    const x = i % this.cols;
    const y = Math.floor(i / this.cols);
    // Prefer upward, then sideways.
    const targets: number[] = [];
    if (y - 1 >= 0) targets.push(idx(x, y - 1, this.cols));
    if (x - 1 >= 0) targets.push(idx(x - 1, y, this.cols));
    if (x + 1 < this.cols) targets.push(idx(x + 1, y, this.cols));
    if (y + 1 < this.rows) targets.push(idx(x, y + 1, this.cols));
    for (const j of targets) {
      if (remaining <= WATER_EPSILON) break;
      const m = this.grid[j];
      if (m !== MAT.Empty) continue;
      const cap = CELL_CAPACITY - (this.clean[j] + this.dirty[j]);
      const move = Math.min(remaining, cap);
      if (move <= 0) continue;
      this.clean[j] += move * cRatio;
      this.dirty[j] += move * (1 - cRatio);
      remaining -= move;
    }
    if (remaining > 0) {
      this.overflowTotal += remaining;
      this.ledger.overflowed += remaining;
    }
  }

  private lockPiece(): void {
    if (!this.piece || this.status !== 'playing') return;
    const piece = this.piece;
    let blocked = false;
    // Check whether any cell is above the field: that space is unusable.
    for (const c of piece.cells) {
      if (this.pieceY + c.y < 0) blocked = true;
    }
    const placed: number[] = [];
    for (const c of piece.cells) {
      const x = this.pieceX + c.x;
      const y = this.pieceY + c.y;
      if (y < 0) continue;
      const i = idx(x, y, this.cols);
      this.displaceWaterAt(i);
      if (piece.kind === 'pocket' || piece.kind === 'pocketDirty') {
        this.grid[i] = MAT.Empty;
      } else {
        this.grid[i] = piece.material;
        const meta = this.meta[i];
        meta.dir = piece.dir;
        meta.cracked = false;
        meta.fixed = false;
        meta.absorbClean = 0;
        meta.absorbDirty = 0;
        meta.clog = 0;
      }
      placed.push(i);
    }
    if (piece.kind === 'pocket' || piece.kind === 'pocketDirty') {
      this.injectWater(placed, piece.volume, piece.dirty);
    }
    this.placements.push({ t: this.tick, x: this.pieceX, r: this.rot, h: this.heldThisPiece, drop: this.dropMode });
    this.blocksUsed++;
    this.piece = null;
    this.holdUsed = false;
    this.lastEvents.push({
      type: 'rain',
      cell: -1,
      x: this.pieceX,
      y: this.pieceY,
      amount: 0,
      reason: `lock:${piece.kind}`,
    });
    if (blocked && this.status === 'playing') {
      this.lose('noSpace');
      return;
    }
    if (this.blocksUsed >= this.blockLimit) {
      this.updateGoals();
      if (!allGoalsDone(this.goals)) {
        this.lose('outOfBlocks');
        return;
      }
    }
    if (this.status === 'playing') this.spawn();
  }

  private injectWater(cells: number[], volume: number, dirty: boolean): void {
    this.ledger.injected += volume;
    let remaining = volume;
    // Fill own footprint first.
    for (const i of cells) {
      if (remaining <= 0) break;
      if (this.grid[i] === MAT.Sponge) {
        const meta = this.meta[i];
        const room = Math.max(0, 2 - meta.absorbClean - meta.absorbDirty);
        const take = Math.min(remaining, room);
        if (dirty) meta.absorbDirty += take;
        else meta.absorbClean += take;
        remaining -= take;
        continue;
      }
      if (this.grid[i] !== MAT.Empty) continue;
      const room = CELL_CAPACITY - (this.clean[i] + this.dirty[i]);
      const fill = Math.min(remaining, room);
      if (dirty) this.dirty[i] += fill;
      else this.clean[i] += fill;
      remaining -= fill;
    }
    if (remaining <= 0) return;
    // Spill upward / sideways into free cells (BFS-ish, deterministic order).
    const candidates: number[] = [];
    for (const i of cells) {
      const x = i % this.cols;
      const y = Math.floor(i / this.cols);
      if (y - 1 >= 0) candidates.push(idx(x, y - 1, this.cols));
      if (x - 1 >= 0) candidates.push(idx(x - 1, y, this.cols));
      if (x + 1 < this.cols) candidates.push(idx(x + 1, y, this.cols));
    }
    candidates.sort((a, b) => a - b);
    for (const j of candidates) {
      if (remaining <= 0) break;
      if (this.grid[j] !== MAT.Empty) continue;
      const room = CELL_CAPACITY - (this.clean[j] + this.dirty[j]);
      const fill = Math.min(remaining, room);
      if (dirty) this.dirty[j] += fill;
      else this.clean[j] += fill;
      remaining -= fill;
    }
    if (remaining > 0) {
      this.overflowTotal += remaining;
      this.ledger.overflowed += remaining;
    }
  }

  // --- Tick ----------------------------------------------------------------

  step(): void {
    if (this.status !== 'playing') return;
    this.tick++;

    const cfg: SimOptions = {
      cols: this.cols,
      rows: this.rows,
      drains: this.drains,
      meta: this.meta,
      pressure: this.pressure,
      pressureScale: this.mode === 'endless' ? 1.2 : 1,
      destruction: true,
    };
    const res = simulate(this.grid, { clean: this.clean, dirty: this.dirty }, this.tick, cfg);
    this.grid = res.grid;
    this.clean = res.water.clean;
    this.dirty = res.water.dirty;
    this.pressure = res.pressure;
    this.meta = res.meta;
    this.lastEvents = res.events;

    // The simulation reports per-tick totals; accumulate them here.
    this.ledger.drainedClean += res.drainedClean;
    this.ledger.drainedDirty += res.drainedDirty;
    for (let d = 0; d < this.drains.length; d++) {
      this.drainClean[d] += res.drainClean[d] ?? 0;
      this.drainDirty[d] += res.drainDirty[d] ?? 0;
    }
    this.lastDrainClean = res.drainedClean;
    this.lastDrainDirty = res.drainedDirty;
    this.ledger.pollution += res.pollution;
    this.ledger.wasted += res.wasted;
    this.ledger.overflowed += res.overflowed;
    this.overflowTotal += res.overflowed;
    this.lastOverflow = res.overflowed;

    if (this.mode === 'endless') {
      this.endlessTimer++;
      if (this.endlessTimer >= 150) {
        this.endlessTimer = 0;
        this.rainDrops();
      }
    }

    // Gravity + lock delay (skipped in manual-gravity replay mode; the
    // replayer drives the piece itself).
    if (this.piece && !this.manualGravity) {
      this.grounded = this.isGrounded();
      if (this.grounded) {
        this.lockTimer++;
        if (this.lockTimer >= LOCK_DELAY_TICKS) this.lockPiece();
      } else {
        this.lockTimer = 0;
        this.fallTimer++;
        if (this.fallTimer >= Math.max(4, this.level.fallInterval)) {
          this.fallTimer = 0;
          this.tryMove(0, 1);
        }
      }
    }

    this.recomputeDerived();

    if (this.status !== 'playing') return;

    const pollutionLimit = (this.mode as string) === 'endless' ? POLLUTION_LIMIT + 3 : POLLUTION_LIMIT;
    if (this.ledger.pollution >= pollutionLimit) {
      this.lose('pollution');
      return;
    }
    if (this.overflowTotal >= OVERFLOW_LIMIT) {
      const col = this.findOverflowColumn();
      this.lose('overflow', col);
      return;
    }
    if (this.isKeyDrainBlocked()) {
      this.lose('blockedDrain');
      return;
    }
    this.updateGoals();
    if (allGoalsDone(this.goals)) {
      this.win();
    }
  }

  private rainDrops(): void {
    const col = Math.floor((Math.sin(this.tick * 0.013) * 0.5 + 0.5) * this.cols) % this.cols;
    const i = idx(col, 0, this.cols);
    if (this.grid[i] === MAT.Empty) {
      const cap = CELL_CAPACITY - (this.clean[i] + this.dirty[i]);
      const add = Math.min(cap, 0.5);
      this.clean[i] += add;
      this.ledger.injected += add;
    }
  }

  private findOverflowColumn(): number {
    for (let x = 0; x < this.cols; x++) {
      const i = idx(x, 0, this.cols);
      if (this.clean[i] + this.dirty[i] > 0.9) return x;
    }
    return 0;
  }

  private isKeyDrainBlocked(): boolean {
    // A drain is "permanently blocked" if every drain is covered by sand/soil
    // and there is still water in the field that cannot reach one.
    const wet = this.totalFieldWater();
    if (wet < 2) return false;
    const anyOpen = this.drains.some((d) => {
      const i = idx(d.x, d.y, this.cols);
      return this.grid[i] === MAT.DrainClean || this.grid[i] === MAT.DrainDirty;
    });
    return !anyOpen;
  }

  recomputeDerived(): void {
    let waterline = this.rows;
    this.dangerCols = [];
    this.mixture = [];
    let field = spongeWater(this.meta);
    for (let i = 0; i < this.clean.length; i++) {
      const c = this.clean[i];
      const d = this.dirty[i];
      const total = c + d;
      field += total;
      if (c > 0.001 && d > 0.001) this.mixture.push(i);
      if (total > 0.02) {
        const y = Math.floor(i / this.cols);
        if (y < waterline) waterline = y;
      }
    }
    this.waterline = waterline;
    this.ledger.inField = field;
    this.ledger.absorbed = spongeWater(this.meta);

    for (let x = 0; x < this.cols; x++) {
      let danger = false;
      for (let y = 0; y < this.rows; y++) {
        const i = idx(x, y, this.cols);
        if (this.pressure[i] > 0.35) danger = true;
        if (y <= 2 && this.clean[i] + this.dirty[i] > 0.5) danger = true;
      }
      if (danger) this.dangerCols.push(x);
    }
    this.stateHash = this.computeHash();
  }

  updateGoals(): void {
    this.goals = evaluateGoals(this.level, {
      drainClean: this.drainClean,
      drainDirty: this.drainDirty,
      ledger: this.ledger,
      waterline: this.waterline,
      score: this.score,
      tick: this.tick,
    });
  }

  private win(): void {
    if (this.status !== 'playing') return;
    this.updateGoals();
    this.score = finalScore(this.ledger, this.blocksUsed, this.blockLimit, true);
    this.status = 'won';
    this.updateGoals();
  }

  private lose(kind: 'overflow' | 'pollution' | 'blockedDrain' | 'noSpace' | 'outOfBlocks', col?: number): void {
    if (this.status !== 'playing') return;
    const info = describeFailure(kind, col);
    this.status = 'lost';
    this.failureReason = info.reason;
    this.score = finalScore(this.ledger, this.blocksUsed, this.blockLimit, false);
  }

  // --- Introspection -------------------------------------------------------

  preview(steps = 3): SimPreview {
    const res = previewFlow(
      this.grid,
      { clean: this.clean, dirty: this.dirty },
      this.tick,
      {
        cols: this.cols,
        rows: this.rows,
        drains: this.drains,
        meta: this.meta,
        pressure: this.pressure,
        pressureScale: 0.8,
      },
      steps,
      10,
    );
    return res;
  }
  getStateHash(): string {
    return this.stateHash.toString(16).padStart(8, '0');
  }

  hashTick(): number {
    let h = hashFloats(this.clean);
    h = hashFloats(this.dirty, h);
    h = hashFloats(this.pressure, h);
    for (let i = 0; i < this.grid.length; i++) {
      h ^= this.grid[i] * (i + 1);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= (this.tick * 2654435761) >>> 0;
    return h >>> 0;
  }

  private computeHash(): number {
    return this.hashTick();
  }

  totalFieldWater(): number {
    let sum = spongeWater(this.meta);
    for (let i = 0; i < this.clean.length; i++) sum += this.clean[i] + this.dirty[i];
    return sum;
  }

  stars(): number {
    return computeStars(
      this.status === 'won',
      this.overflowTotal > 0.001,
      this.blocksUsed,
      this.level.star3Blocks,
    );
  }

  /** Live score projection; the official score is frozen at win/loss. */
  currentScore(): number {
    if (this.status === 'won' || this.status === 'lost') return this.score;
    return finalScore(this.ledger, this.blocksUsed, this.blockLimit, false);
  }

  view(): EngineView {
    return {
      cols: this.cols,
      rows: this.rows,
      tick: this.tick,
      grid: this.grid,
      clean: this.clean,
      dirty: this.dirty,
      pressure: this.pressure,
      meta: this.meta,
      piece: this.piece
        ? {
            kind: this.piece.kind,
            cells: this.piece.cells,
            x: this.pieceX,
            y: this.pieceY,
            color: this.piece.color,
            material: this.piece.material,
            dir: this.piece.dir,
          }
        : null,
      ghostY: this.piece ? this.ghostY() : this.pieceY,
      next: this.next.slice(),
      hold: this.hold,
      holdUsed: this.holdUsed,
      score: this.score,
      blocksUsed: this.blocksUsed,
      blockLimit: this.blockLimit,
      status: this.status,
      ledger: { ...this.ledger },
      goals: this.goals.map((g) => ({ ...g })),
      dangerCols: this.dangerCols.slice(),
      waterline: this.waterline,
      pollutionStrikes: Math.ceil(this.ledger.pollution - 1e-9),
      overflowTotal: this.overflowTotal,
      seed: this.seed,
      mode: this.mode,
      levelId: this.level.id,
      levelName: this.level.name,
      mixture: this.mixture.slice(0, 40),
      lastEvents: this.lastEvents,
      drainClean: this.drainClean.slice(),
      drainDirty: this.drainDirty.slice(),
      failureReason: this.failureReason,
    };
  }
}
