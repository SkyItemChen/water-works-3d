import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { simulate, previewFlow, totalWater, spongeWater } from '../game/core/simulation';
import { MAT, createMeta, type CellMeta, type DrainDef } from '../game/core/types';
import { contractLevels, levelById, validateLevel } from '../game/core/level';
import { computeStars, drainScore, evaluateGoals, finalScore } from '../game/core/scoring';
import { Bag, makePiece, rotateCells } from '../game/core/bag';
import { hashSeed, mulberry32, xmur3 } from '../game/core/rng';
import { dailyLevel, dateSeed, todayKey } from '../game/core/daily';

function emptyMeta(n: number): CellMeta[] {
  return Array.from({ length: n }, () => createMeta());
}

function water(cols: number, rows: number) {
  return { clean: new Float64Array(cols * rows), dirty: new Float64Array(cols * rows) };
}

function drain(x: number, y: number, id = 0, kind: 'clean' | 'dirty' = 'clean'): DrainDef {
  return { id, x, y, kind };
}

describe('water conservation', () => {
  it('conserves every unit across 600 ticks of turbulent flow', () => {
    const cols = 10;
    const rows = 12;
    const grid = new Uint8Array(cols * rows);
    // A basin: walls on both sides, random internal pillars.
    for (let y = 0; y < rows; y++) {
      grid[y * cols] = MAT.Soil;
      grid[y * cols + cols - 1] = MAT.Soil;
    }
    grid[5 * cols + 4] = MAT.Soil;
    grid[6 * cols + 4] = MAT.Soil;
    grid[8 * cols + 6] = MAT.Sand;
    grid[8 * cols + 7] = MAT.Sand;
    const w = water(cols, rows);
    w.clean[0 * cols + 3] = 1;
    w.clean[1 * cols + 3] = 0.7;
    w.dirty[0 * cols + 6] = 0.9;
    for (let i = 0; i < cols * rows; i += 17) w.clean[i] += 0.15;

    let meta = emptyMeta(cols * rows);
    let pressure = new Float64Array(cols * rows);
    let cur = w;
    let drainedTotal = 0;
    let overflowedTotal = 0;
    let g = grid;
    const initial = totalWater(w);
    for (let t = 1; t <= 600; t++) {
      const res = simulate(g, cur, t, {
        cols,
        rows,
        meta,
        pressure,
        drains: [drain(3, rows - 1, 0, 'clean'), drain(6, rows - 1, 1, 'dirty')],
        pressureScale: 1,
      });
      cur = res.water;
      meta = res.meta;
      pressure = res.pressure;
      g = res.grid;
      drainedTotal += res.drainedClean + res.drainedDirty;
      overflowedTotal += res.overflowed;
      const inField = totalWater(cur) + spongeWater(meta);
      // Water may only leave via a drain, the overflow line, or a sponge.
      expect(inField + drainedTotal + overflowedTotal).toBeCloseTo(initial, 6);
    }
  });

  it('is a pure function: inputs are never mutated', () => {
    const cols = 6;
    const rows = 6;
    const grid = new Uint8Array(cols * rows);
    grid[5 * cols + 2] = MAT.Soil;
    const w = water(cols, rows);
    w.clean[0] = 0.8;
    w.dirty[0] = 0.2;
    const gridCopy = new Uint8Array(grid);
    const cleanCopy = new Float64Array(w.clean);
    const meta = emptyMeta(cols * rows);
    const metaDir = meta.map((m) => m.dir);
    simulate(grid, w, 1, { cols, rows, meta });
    expect(Array.from(grid)).toEqual(Array.from(gridCopy));
    expect(Array.from(w.clean)).toEqual(Array.from(cleanCopy));
    expect(meta.map((m) => m.dir)).toEqual(metaDir);
  });

  it('does not exceed a cell capacity of 1 unit', () => {
    const cols = 5;
    const rows = 10;
    const grid = new Uint8Array(cols * rows);
    for (let x = 0; x < cols; x++) grid[(rows - 1) * cols + x] = MAT.Soil;
    let w = water(cols, rows);
    for (let i = 0; i < 30; i++) w.clean[i * 3] += 0.4;
    let meta = emptyMeta(cols * rows);
    let pressure = new Float64Array(cols * rows);
    let g = grid;
    for (let t = 0; t < 300; t++) {
      const res = simulate(g, w, t, { cols, rows, meta, pressure, drains: [] });
      w = res.water;
      meta = res.meta;
      pressure = res.pressure;
      g = res.grid;
      for (let i = 0; i < cols * rows; i++) {
        expect(w.clean[i] + w.dirty[i]).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});

describe('collision and flow rules', () => {
  it('water cannot pass through solid soil', () => {
    const cols = 5;
    const rows = 6;
    const grid = new Uint8Array(cols * rows);
    // Solid floor of soil across row 4.
    for (let x = 0; x < cols; x++) grid[4 * cols + x] = MAT.Soil;
    const w = water(cols, rows);
    w.clean[1 * cols + 2] = 1;
    const res = simulate(grid, w, 1, { cols, rows, drains: [] });
    // Nothing may reach row 5 (below the floor).
    for (let x = 0; x < cols; x++) {
      expect(res.water.clean[5 * cols + x] + res.water.dirty[5 * cols + x]).toBe(0);
    }
  });

  it('flows down before sideways (fixed order)', () => {
    const cols = 3;
    const rows = 4;
    const grid = new Uint8Array(cols * rows);
    const w = water(cols, rows);
    w.clean[0 * cols + 1] = 1; // top middle
    const res = simulate(grid, w, 1, { cols, rows, drains: [] });
    const below = res.water.clean[1 * cols + 1];
    const left = res.water.clean[1 * cols + 0];
    expect(below).toBeGreaterThan(left);
    expect(below).toBeGreaterThan(0);
  });

  it('a pipe forces water toward its direction', () => {
    const cols = 5;
    const rows = 5;
    const grid = new Uint8Array(cols * rows);
    const meta = emptyMeta(cols * rows);
    // Pipe at (2,2) pointing right.
    grid[2 * cols + 2] = MAT.Pipe;
    meta[2 * cols + 2].dir = 1;
    const w = water(cols, rows);
    w.clean[2 * cols + 2] = 1;
    const res = simulate(grid, w, 1, { cols, rows, meta, drains: [] });
    const right = res.water.clean[2 * cols + 3];
    const below = res.water.clean[3 * cols + 2];
    expect(right).toBeGreaterThan(below);
  });

  it('a sponge absorbs at most 2 units and then stops', () => {
    const cols = 3;
    const rows = 3;
    const grid = new Uint8Array(cols * rows);
    grid[1 * cols + 1] = MAT.Sponge;
    let w = water(cols, rows);
    // Feed 1 unit per tick from above for 10 ticks.
    let meta = emptyMeta(cols * rows);
    let pressure = new Float64Array(cols * rows);
    let g = grid;
    let absorbed = 0;
    for (let t = 0; t < 400; t++) {
      w.clean[0 * cols + 1] = 1;
      const res = simulate(g, w, t, { cols, rows, meta, pressure, drains: [] });
      w = res.water;
      meta = res.meta;
      pressure = res.pressure;
      g = res.grid;
      absorbed = spongeWater(meta);
    }
    expect(absorbed).toBeLessThanOrEqual(2.0001);
    expect(absorbed).toBeGreaterThan(0);
  });

  it('a filter converts dirty to clean and clogs after 3 units', () => {
    const cols = 3;
    const rows = 3;
    const grid = new Uint8Array(cols * rows);
    grid[1 * cols + 1] = MAT.Filter;
    let w = water(cols, rows);
    let meta = emptyMeta(cols * rows);
    let pressure = new Float64Array(cols * rows);
    let g = grid;
    let producedClean = 0;
    for (let t = 0; t < 400; t++) {
      // Keep re-wetting the filter cell with dirty water.
      w.dirty[1 * cols + 1] = Math.max(w.dirty[1 * cols + 1], 1);
      const res = simulate(g, w, t, { cols, rows, meta, pressure, drains: [] });
      w = res.water;
      meta = res.meta;
      pressure = res.pressure;
      g = res.grid;
      producedClean = Math.max(producedClean, w.clean[1 * cols + 1]);
    }
    expect(meta[1 * cols + 1].clog).toBeGreaterThanOrEqual(2.9);
    expect(producedClean).toBeGreaterThan(0);
  });

  it('sand collapses under sustained pressure', () => {
    const cols = 3;
    const rows = 4;
    const grid = new Uint8Array(cols * rows);
    // A sand plug with full water above it and walls around.
    grid[1 * cols + 1] = MAT.Sand;
    grid[2 * cols + 1] = MAT.Sand;
    const meta = emptyMeta(cols * rows);
    let w = water(cols, rows);
    w.clean[0 * cols + 1] = 1;
    let pressure = new Float64Array(cols * rows);
    let g = grid;
    let collapsed = false;
    for (let t = 0; t < 3000; t++) {
      w.clean[0 * cols + 1] = 1;
      const res = simulate(g, w, t, { cols, rows, meta, pressure, drains: [] });
      w = res.water;
      pressure = res.pressure;
      g = res.grid;
      if (g[1 * cols + 1] !== MAT.Sand) collapsed = true;
    }
    expect(collapsed).toBe(true);
  });
});

describe('drain scoring', () => {
  it('clean water into a clean drain scores 10 per unit', () => {
    const cols = 3;
    const rows = 3;
    const grid = new Uint8Array(cols * rows);
    const drains = [drain(1, 2, 0, 'clean')];
    grid[2 * cols + 1] = MAT.DrainClean;
    let w = water(cols, rows);
    w.clean[1 * cols + 1] = 1;
    let meta = emptyMeta(cols * rows);
    let pressure = new Float64Array(cols * rows);
    let drained = 0;
    let g = grid;
    for (let t = 0; t < 30; t++) {
      const res = simulate(g, w, t, { cols, rows, meta, pressure, drains });
      w = res.water;
      meta = res.meta;
      pressure = res.pressure;
      g = res.grid;
      drained += res.drainedClean;
    }
    expect(drained).toBeCloseTo(1, 5);
    expect(Math.round(drained * 10)).toBe(10);
  });

  it('dirty water into a dirty drain scores 4 per unit and clean water is penalised', () => {
    const cols = 3;
    const rows = 3;
    const grid = new Uint8Array(cols * rows);
    grid[2 * cols + 1] = MAT.DrainDirty;
    let w = water(cols, rows);
    w.clean[1 * cols + 1] = 0.5;
    w.dirty[1 * cols + 1] = 0.5;
    let meta = emptyMeta(cols * rows);
    let pressure = new Float64Array(cols * rows);
    let cfg = { cols, rows, meta, pressure, drains: [drain(1, 2, 0, 'dirty')] };
    let res = simulate(grid, w, 0, cfg);
    let c = 0;
    let d = 0;
    let wasted = 0;
    for (let t = 0; t < 30; t++) {
      cfg = { ...cfg, meta, pressure, drains: [drain(1, 2, 0, 'dirty')] };
      res = simulate(grid, w, t, cfg);
      w = res.water;
      meta = res.meta;
      pressure = res.pressure;
      c += res.drainedClean;
      d += res.drainedDirty;
      wasted += res.wasted;
    }
    expect(d).toBeCloseTo(0.5, 5);
    expect(wasted).toBeCloseTo(0.5, 5);
    expect(Math.round(d * 4)).toBe(2);
    expect(drainScore({ injected: 1, drainedClean: c, drainedDirty: d, inField: 0, overflowed: 0, pollution: 0, wasted, absorbed: 0 })).toBe(2 - Math.round(wasted * 2));
  });

  it('dirty water reaching a clean drain counts as pollution', () => {
    const cols = 3;
    const rows = 3;
    const grid = new Uint8Array(cols * rows);
    grid[2 * cols + 1] = MAT.DrainClean;
    const w = water(cols, rows);
    w.dirty[1 * cols + 1] = 1;
    let meta = emptyMeta(cols * rows);
    let pressure = new Float64Array(cols * rows);
    const drains = [drain(1, 2, 0, 'clean')];
    let pollution = 0;
    for (let t = 0; t < 30; t++) {
      const res = simulate(grid, w, t, { cols, rows, meta, pressure, drains });
      meta = res.meta;
      pressure = res.pressure;
      w.clean = res.water.clean;
      w.dirty = res.water.dirty;
      pollution += res.pollution;
    }
    expect(pollution).toBeCloseTo(1, 5);
  });
});

describe('determinism', () => {
  function runScripted(seed: number): { hash: string; ledgerSum: number; blocks: number } {
    const level = levelById('c01')!;
    const engine = new GameEngine({ level, seed, mode: 'contract' });
    const script: ('L' | 'R' | 'C' | 'A' | 'H')[] = ['L', 'C', 'A', 'R', 'A', 'A', 'H', 'A'];
    for (const a of script) {
      engine.handleAction(a);
      for (let i = 0; i < 24; i++) engine.step();
      if (engine.status !== 'playing') break;
    }
    for (let i = 0; i < 240; i++) engine.step();
    return {
      hash: engine.getStateHash(),
      ledgerSum:
        engine.ledger.drainedClean +
        engine.ledger.drainedDirty +
        engine.ledger.inField +
        engine.ledger.overflowed,
      blocks: engine.blocksUsed,
    };
  }

  it('same seed + same inputs produce an identical state hash', () => {
    const a = runScripted(424242);
    const b = runScripted(424242);
    expect(b.hash).toBe(a.hash);
    expect(b.blocks).toBe(a.blocks);
    expect(b.ledgerSum).toBeCloseTo(a.ledgerSum, 8);
  });

  it('different seeds diverge', () => {
    const a = runScripted(1);
    const b = runScripted(999999);
    // Piece order differs, so hashes should differ.
    expect(a.hash).not.toBe(b.hash);
  });

  it('the rng primitives are deterministic', () => {
    const r1 = mulberry32(123);
    const r2 = mulberry32(123);
    for (let i = 0; i < 100; i++) expect(r1()).toBe(r2());
    expect(xmur3('waterworks')()).toBe(xmur3('waterworks')());
    expect(hashSeed(7, 'bag')).toBe(hashSeed(7, 'bag'));
  });

  it('the 7-bag yields a balanced distribution', () => {
    const bag = new Bag(['soil2', 'pocket', 'sponge', 'pipe', 'sand', 'valve', 'filter'], 12345, 7);
    const counts = new Map<string, number>();
    for (let i = 0; i < 700; i++) {
      const k = bag.next();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // 100 bags of 7 -> every type should appear ~100 times.
    for (const [, n] of counts) {
      expect(n).toBeGreaterThan(60);
      expect(n).toBeLessThan(140);
    }
  });

  it('the preview is deterministic and does not mutate state', () => {
    const level = levelById('c01')!;
    const engine = new GameEngine({ level, seed: 5, mode: 'contract' });
    for (let i = 0; i < 90; i++) engine.step();
    const before = engine.getStateHash();
    const p1 = engine.preview(3);
    const p2 = engine.preview(3);
    expect(engine.getStateHash()).toBe(before);
    expect(Array.from(p1.clean)).toEqual(Array.from(p2.clean));
  });
});

describe('piece geometry', () => {
  it('rotates an L piece through four distinct orientations', () => {
    const shapes = new Set<string>();
    let cells = makePiece('soilL', 0).cells;
    let w = 2;
    let h = 2;
    for (let r = 0; r < 4; r++) {
      shapes.add(cells.map((c) => `${c.x},${c.y}`).sort().join('|'));
      const res = rotateCells(cells, w, h);
      cells = res.cells;
      w = res.width;
      h = res.height;
    }
    expect(shapes.size).toBe(4);
  });

  it('keeps the 2x2 pocket footprint stable under rotation', () => {
    const p = makePiece('pocket', 3);
    expect(p.cells.length).toBe(4);
    expect(p.width).toBe(2);
    expect(p.height).toBe(2);
  });
});

describe('levels and goals', () => {
  it('ships at least 10 playable contract levels', () => {
    const levels = contractLevels();
    expect(levels.length).toBeGreaterThanOrEqual(10);
  });

  it('every contract level passes structural validation', () => {
    for (const l of contractLevels()) {
      expect(validateLevel(l), `level ${l.id}`).toEqual([]);
    }
  });

  it('every level has a reachable drain and a non-empty block pool', () => {
    for (const l of contractLevels()) {
      expect(l.drains.length).toBeGreaterThan(0);
      expect(l.pool.length).toBeGreaterThan(0);
      expect(l.goals.length).toBeGreaterThan(0);
      for (const d of l.drains) expect(d.y).toBe(l.rows - 1);
    }
  });

  it('evaluates drain goals from per-drain counters', () => {
    const level = levelById('c01')!;
    const goals = evaluateGoals(level, {
      drainClean: [8],
      drainDirty: [0],
      ledger: { injected: 8, drainedClean: 8, drainedDirty: 0, inField: 0, overflowed: 0, pollution: 0, wasted: 0, absorbed: 0 },
      waterline: 12,
      score: 80,
      tick: 100,
    });
    expect(goals[0].done).toBe(true);
  });

  it('computes stars from goal, overflow and block par', () => {
    expect(computeStars(false, false, 3, 5)).toBe(0);
    expect(computeStars(true, true, 3, 5)).toBe(1);
    expect(computeStars(true, false, 9, 5)).toBe(2);
    expect(computeStars(true, false, 4, 5)).toBe(3);
  });

  it('final score rewards efficiency', () => {
    const ledger = {
      injected: 10,
      drainedClean: 10,
      drainedDirty: 0,
      inField: 0,
      overflowed: 0,
      pollution: 0,
      wasted: 0,
      absorbed: 0,
    };
    expect(finalScore(ledger, 5, 10, true)).toBe(100 + 5 * 15);
    expect(finalScore(ledger, 5, 10, false)).toBe(100);
  });
});

describe('daily challenge', () => {
  it('is stable for a given date and changes across dates', () => {
    const a = dailyLevel('2026-01-01');
    const b = dailyLevel('2026-01-01');
    const c = dailyLevel('2026-01-02');
    expect(a.seed).toBe(b.seed);
    expect(a.pool).toEqual(b.pool);
    expect(a.seed).not.toBe(c.seed);
    expect(dateSeed(todayKey())).toBeGreaterThan(0);
  });
});

describe('preview padding and edges', () => {
  it('handles an empty grid without throwing', () => {
    const p = previewFlow(new Uint8Array(20), { clean: new Float64Array(20), dirty: new Float64Array(20) }, 0, {
      cols: 5,
      rows: 4,
    });
    expect(p.topRow.length).toBe(5);
    expect(totalWater({ clean: p.clean, dirty: p.dirty })).toBe(0);
  });
});
