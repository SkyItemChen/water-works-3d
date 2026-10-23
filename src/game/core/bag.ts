/**
 * Block catalogue + deterministic 7-bag generator.
 *
 * Every block is a small set of cells. Rotation is a pure integer operation so
 * the same input sequence always produces the same footprint.
 */

import { MAT, type BlockCell, type BlockDef, type BlockKind, type BlockPiece, type Dir } from './types';
import { hashSeed, type Rng, makeRng } from './rng';

export const BLOCKS: Record<BlockKind, BlockDef> = {
  soil2: {
    kind: 'soil2',
    name: '土壤 2×2',
    material: MAT.Soil,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    width: 2,
    height: 2,
    rotatable: false,
    color: '#8a5a3b',
  },
  soilL: {
    kind: 'soilL',
    name: 'L 形土壤',
    material: MAT.Soil,
    cells: [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    width: 2,
    height: 2,
    rotatable: true,
    color: '#9a6744',
  },
  pocket: {
    kind: 'pocket',
    name: '清水囊',
    material: MAT.Empty,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    width: 2,
    height: 2,
    volume: 4,
    dirty: false,
    rotatable: false,
    color: '#39c5ff',
  },
  pocketDirty: {
    kind: 'pocketDirty',
    name: '污水囊',
    material: MAT.Empty,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    width: 2,
    height: 2,
    volume: 4,
    dirty: true,
    rotatable: false,
    color: '#6f7a33',
  },
  sponge: {
    kind: 'sponge',
    name: '海绵',
    material: MAT.Sponge,
    cells: [{ x: 0, y: 0 }],
    width: 1,
    height: 1,
    rotatable: false,
    color: '#f2b6c6',
  },
  pipe: {
    kind: 'pipe',
    name: '管道',
    material: MAT.Pipe,
    cells: [{ x: 0, y: 0 }],
    width: 1,
    height: 1,
    dir: 2,
    rotatable: true,
    color: '#9aa7b4',
  },
  sand: {
    kind: 'sand',
    name: '沙块',
    material: MAT.Sand,
    cells: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
    width: 2,
    height: 1,
    rotatable: true,
    color: '#d8bd83',
  },
  valve: {
    kind: 'valve',
    name: '单向阀',
    material: MAT.Valve,
    cells: [{ x: 0, y: 0 }],
    width: 1,
    height: 1,
    dir: 2,
    rotatable: true,
    color: '#ffc857',
  },
  filter: {
    kind: 'filter',
    name: '过滤器',
    material: MAT.Filter,
    cells: [{ x: 0, y: 0 }],
    width: 1,
    height: 1,
    rotatable: false,
    color: '#a8e6cf',
  },
  ice: {
    kind: 'ice',
    name: '冰块',
    material: MAT.Ice,
    cells: [{ x: 0, y: 0 }],
    width: 1,
    height: 1,
    rotatable: false,
    color: '#bfeaff',
  },
};

export const ALL_BLOCK_KINDS: BlockKind[] = [
  'soil2',
  'soilL',
  'pocket',
  'pocketDirty',
  'sponge',
  'pipe',
  'sand',
  'valve',
  'filter',
  'ice',
];

/**
 * Rotate a footprint by 90° clockwise around its bounding box.
 * Pure and deterministic (integer arithmetic only).
 */
export function rotateCells(cells: BlockCell[], width: number, height: number): { cells: BlockCell[]; width: number; height: number } {
  const out = cells.map((c) => ({ x: height - 1 - c.y, y: c.x }));
  return { cells: out, width: height, height: width };
}

export function rotateDir(dir: Dir): Dir {
  return ((dir + 1) % 4) as Dir;
}

/** Build a fresh piece from a kind, applying rotation count. */
export function makePiece(kind: BlockKind, rotation = 0): BlockPiece {
  const def = BLOCKS[kind];
  let cells = def.cells.map((c) => ({ ...c }));
  let w = def.width;
  let h = def.height;
  let dir = (def.dir ?? 2) as Dir;
  const rot = def.rotatable ? ((rotation % 4) + 4) % 4 : 0;
  for (let r = 0; r < rot; r++) {
    const res = rotateCells(cells, w, h);
    cells = res.cells;
    w = res.width;
    h = res.height;
    dir = rotateDir(dir);
  }
  return {
    kind,
    cells,
    width: w,
    height: h,
    material: def.material,
    dir,
    volume: def.volume ?? 0,
    dirty: def.dirty ?? false,
    color: def.color,
    rotation: rot,
  };
}

/**
 * 7-bag generator. A bag is a shuffled set of the allowed kinds, refilled when
 * empty. Seeded via xmur3 -> mulberry32 so the whole sequence is reproducible.
 */
export class Bag {
  private rng: Rng;
  private pool: BlockKind[];
  private queue: BlockKind[] = [];

  constructor(
    private readonly allowed: BlockKind[],
    seed: number,
    private readonly bagSize = 7,
  ) {
    this.pool = allowed.length > 0 ? allowed.slice() : ['soil2'];
    this.rng = makeRng(seed, 'bag');
    this.refill();
  }

  private refill(): void {
    const bag: BlockKind[] = [];
    for (let i = 0; i < this.bagSize; i++) {
      bag.push(this.pool[Math.floor(this.rng() * this.pool.length) % this.pool.length]);
    }
    // Fisher-Yates with the same rng.
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
    this.queue.push(...bag);
  }

  next(): BlockKind {
    if (this.queue.length === 0) this.refill();
    return this.queue.shift() as BlockKind;
  }

  /** Peek without consuming (n = number of upcoming pieces). */
  peek(n: number): BlockKind[] {
    while (this.queue.length < n + 1) this.refill();
    return this.queue.slice(0, n);
  }

  /** Consume a specific piece (used when a hold is swapped back in). */
  consume(kind: BlockKind): void {
    const at = this.queue.indexOf(kind);
    if (at >= 0) this.queue.splice(at, 1);
  }
}

export function bagForLevel(pool: BlockKind[], seed: number): Bag {
  return new Bag(pool, hashSeed(seed, 'level-bag'), 7);
}
