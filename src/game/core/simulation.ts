/**
 * Deterministic voxel water simulation.
 *
 * `simulate` is PURE: it never mutates its inputs and returns freshly
 * allocated arrays. Movement is double-buffered: every cell reads from a
 * source snapshot and writes into a destination buffer, so water can never hop
 * twice in a single tick regardless of traversal order.
 *
 * Conservation: every unit subtracted from a cell is added to another cell, to
 * a sponge, to a drain counter, or to the overflow counter. Nothing is lost.
 *
 * Movement order is fixed: DOWN, then LEFT, then RIGHT. Pipes and valves
 * override that with their forced direction.
 */

import {
  CELL_CAPACITY,
  FILTER_CLOG_LIMIT,
  FILTER_RATE,
  FLOW_DOWN,
  FLOW_PIPE,
  FLOW_SIDE,
  PRESSURE_DECAY,
  PRESSURE_GAIN,
  PRESSURE_PIPE,
  PRESSURE_SAND,
  PRESSURE_SOIL,
  PRESSURE_SPONGE,
  SPONGE_ABSORB_RATE,
  SPONGE_CAPACITY,
  WATER_EPSILON,
} from './constants';
import {
  DIR_DX,
  DIR_DY,
  MAT,
  type CellMeta,
  type DrainDef,
  type SimConfig,
  type SimEvent,
  type SimResult,
  type WaterField,
  createMeta,
} from './types';

function idx(x: number, y: number, cols: number): number {
  return y * cols + x;
}

function cloneMeta(meta: CellMeta[] | undefined, size: number): CellMeta[] {
  const out: CellMeta[] = new Array(size);
  for (let i = 0; i < size; i++) {
    const src = meta?.[i];
    out[i] = src ? { ...src } : createMeta();
  }
  return out;
}

/** Deterministic tiny hash used for structural collapse variation. */
function cellHash(tick: number, i: number): number {
  let h = (tick * 374761393 + i * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return h / 4294967296;
}

export function totalWater(water: WaterField): number {
  let sum = 0;
  for (let i = 0; i < water.clean.length; i++) sum += water.clean[i] + water.dirty[i];
  return sum;
}

export function spongeWater(meta: CellMeta[]): number {
  let sum = 0;
  for (const m of meta) sum += m.absorbClean + m.absorbDirty;
  return sum;
}

export interface SimOptions extends SimConfig {
  meta?: CellMeta[];
  pressure?: Float64Array;
  drains?: DrainDef[];
}

/**
 * Advance the water field one fixed tick.
 */
export function simulate(grid: Uint8Array, water: WaterField, tick: number, config: SimOptions): SimResult {
  const cols = config.cols;
  const rows = config.rows;
  const size = cols * rows;
  const pressureScale = config.pressureScale ?? 1;
  const destruction = config.destruction ?? true;

  const g = new Uint8Array(grid);
  const srcClean = water.clean;
  const srcDirty = water.dirty;
  // Destination buffers start as copies of the source.
  const clean = new Float64Array(water.clean);
  const dirty = new Float64Array(water.dirty);
  /**
   * Per-cell movement budget captured from the source snapshot. A cell can
   * only push out water it held at tick start; anything that arrived this tick
   * has zero budget and waits for the next tick. This is what makes the flow
   * true double buffering rather than order-dependent cellular automata.
   */
  const budget = new Float64Array(size);
  for (let i = 0; i < size; i++) budget[i] = srcClean[i] + srcDirty[i];
  const pressure = new Float64Array(config.pressure ?? new Float64Array(size));
  const meta = cloneMeta(config.meta, size);
  const events: SimEvent[] = [];

  const drains = config.drains ?? [];
  const drainMap = new Map<number, DrainDef>();
  for (const d of drains) drainMap.set(idx(d.x, d.y, cols), d);
  const drainClean = new Array<number>(drains.length).fill(0);
  const drainDirty = new Array<number>(drains.length).fill(0);

  let overflowed = 0;
  let drainedClean = 0;
  let drainedDirty = 0;
  let pollution = 0;
  let wasted = 0;
  let filterClogs = 0;

  const canAccept = (j: number): boolean => {
    const m = g[j];
    if (m === MAT.Empty) return true;
    if (m === MAT.DrainClean || m === MAT.DrainDirty) return true;
    if (m === MAT.Sponge) return false;
    if (m === MAT.Filter) return meta[j].clog < FILTER_CLOG_LIMIT;
    if (m === MAT.Pipe || m === MAT.Valve) return true;
    if (m === MAT.Ice) return true;
    if (m === MAT.Soil) return meta[j].cracked;
    return false;
  };

  /** Remove `amount` from cell i, splitting proportionally. Mutates dst only. */
  const take = (i: number, amount: number): { c: number; d: number } => {
    // True double buffering: a cell may only push out water it held at the
    // start of the tick. Water that arrived this tick waits until the next.
    const a = Math.min(amount, budget[i], clean[i] + dirty[i]);
    if (a <= 0) return { c: 0, d: 0 };
    budget[i] -= a;
    const have = clean[i] + dirty[i];
    const c = have > 0 ? a * (clean[i] / have) : 0;
    clean[i] -= c;
    dirty[i] -= a - c;
    return { c, d: a - c };
  };

  const put = (j: number, c: number, d: number): void => {
    if (c <= 0 && d <= 0) return;
    clean[j] += c;
    dirty[j] += d;
  };

  const drainFrom = (j: number, x: number, y: number): void => {
    const d = drainMap.get(j);
    const c = clean[j];
    const dty = dirty[j];
    if (!d) {
      drainedClean += c;
      drainedDirty += dty;
      clean[j] = 0;
      dirty[j] = 0;
      if (c + dty > 0) {
        events.push({ type: 'drain', cell: j, x, y, amount: c + dty, clean: c, dirty: dty });
      }
      return;
    }
    drainClean[d.id] += c;
    drainDirty[d.id] += dty;
    drainedClean += c;
    drainedDirty += dty;
    if (d.kind === 'clean' && dty > 0) pollution += dty;
    if (d.kind === 'dirty' && c > 0) wasted += c;
    clean[j] = 0;
    dirty[j] = 0;
    if (c + dty > 0) {
      events.push({ type: 'drain', cell: j, x, y, amount: c + dty, clean: c, dirty: dty });
    }
  };

  /** Water into a sponge; returns amount absorbed. */
  const spongeTake = (j: number, amount: number): number => {
    const room = Math.max(0, SPONGE_CAPACITY - meta[j].absorbClean - meta[j].absorbDirty);
    const a = Math.min(amount, room, SPONGE_ABSORB_RATE);
    if (a <= 0) return 0;
    const have = clean[j] + dirty[j];
    const cRatio = have > 1e-9 ? clean[j] / have : 0.5;
    const c = a * cRatio;
    meta[j].absorbClean += c;
    meta[j].absorbDirty += a - c;
    events.push({ type: 'spongeAbsorb', cell: j, x: j % cols, y: Math.floor(j / cols), amount: a });
    return a;
  };
  void spongeTake;

  // --- Main flow pass (double buffered) ------------------------------------
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = 0; x < cols; x++) {
      const i = idx(x, y, cols);
      const m = g[i];
      const total = srcClean[i] + srcDirty[i];
      if (total <= WATER_EPSILON) continue;

      const amountHere = clean[i] + dirty[i];

      if (m === MAT.Sponge) {
        // Water already inside a sponge is absorbed into it.
        const a = Math.min(clean[i] + dirty[i], SPONGE_ABSORB_RATE);
        if (a > 0) {
          const t = take(i, a);
          meta[i].absorbClean += t.c;
          meta[i].absorbDirty += t.d;
          events.push({ type: 'spongeAbsorb', cell: i, x, y, amount: a });
        }
        continue;
      }

      if (m === MAT.DrainClean || m === MAT.DrainDirty) {
        drainFrom(i, x, y);
        continue;
      }

      if (m === MAT.Filter && meta[i].clog < FILTER_CLOG_LIMIT && dirty[i] > 0) {
        const convert = Math.min(dirty[i], FILTER_RATE);
        dirty[i] -= convert;
        clean[i] += convert;
        meta[i].clog += convert;
        if (meta[i].clog >= FILTER_CLOG_LIMIT - 1e-9) {
          filterClogs++;
          events.push({ type: 'filterClog', cell: i, x, y, amount: meta[i].clog });
        }
      }

      // A touching sponge wipes filter clog.
      if (m === MAT.Filter && meta[i].clog > 0) {
        for (let dir = 0; dir < 4; dir++) {
          const nx = x + DIR_DX[dir];
          const ny = y + DIR_DY[dir];
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const j = idx(nx, ny, cols);
          if (g[j] !== MAT.Sponge) continue;
          const room = SPONGE_CAPACITY - meta[j].absorbClean - meta[j].absorbDirty;
          if (room <= 0) continue;
          const wipe = Math.min(meta[i].clog, room, 0.05);
          meta[i].clog -= wipe;
          meta[j].absorbClean += wipe;
        }
      }

      if (m === MAT.Pipe || m === MAT.Valve) {
        const nx = x + DIR_DX[meta[i].dir];
        const ny = y + DIR_DY[meta[i].dir];
        const amount = Math.min(amountHere, FLOW_PIPE);
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
          pressure[i] += amount * PRESSURE_GAIN * 0.05 * pressureScale;
          continue;
        }
        const j = idx(nx, ny, cols);
        const targetMat = g[j];
        if (targetMat === MAT.Sponge) {
          const moved = take(i, amount);
          const movedTotal = moved.c + moved.d;
          const room = Math.max(0, SPONGE_CAPACITY - meta[j].absorbClean - meta[j].absorbDirty);
          const absorbed = Math.min(movedTotal, room);
          const c = movedTotal > 0 ? absorbed * (moved.c / movedTotal) : 0;
          meta[j].absorbClean += c;
          meta[j].absorbDirty += absorbed - c;
          // Whatever the sponge cannot hold stays in the pipe.
          clean[i] += moved.c - c;
          dirty[i] += moved.d - (absorbed - c);
          if (absorbed > 0) events.push({ type: 'spongeAbsorb', cell: j, x: nx, y: ny, amount: absorbed });
          continue;
        }
        if (targetMat === MAT.DrainClean || targetMat === MAT.DrainDirty) {
          const moved = take(i, amount);
          clean[j] += moved.c;
          dirty[j] += moved.d;
          drainFrom(j, nx, ny);
          clean[j] = 0;
          dirty[j] = 0;
          continue;
        }
        if (!canAccept(j)) {
          pressure[i] += amount * PRESSURE_GAIN * 0.06 * pressureScale;
          continue;
        }
        const cap = Math.max(0, CELL_CAPACITY - (clean[j] + dirty[j]));
        const move = Math.min(amount, cap);
        if (move > 0) {
          const moved = take(i, move);
          put(j, moved.c, moved.d);
          pressure[i] = Math.max(0, pressure[i] - 0.02);
        }
        continue;
      }

      // Solid voxels: soil is a wall (unless cracked), sand is a plug, ice is
      // a slippery surface that never stores water.
      if (m === MAT.Soil && !meta[i].cracked) continue;
      if (m === MAT.Sand) continue;
      if (m === MAT.Ice) {
        // Ice sheds everything immediately: no residence time.
        let remainingIce = clean[i] + dirty[i];
        for (const [nx, ny] of [
          [x, y + 1],
          [x - 1, y],
          [x + 1, y],
        ] as const) {
          if (remainingIce <= WATER_EPSILON) break;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const j = idx(nx, ny, cols);
          if (g[j] !== MAT.Empty) continue;
          const cap = Math.max(0, CELL_CAPACITY - (clean[j] + dirty[j]));
          const move = Math.min(remainingIce, cap);
          if (move <= 0) continue;
          const moved = take(i, move);
          put(j, moved.c, moved.d);
          remainingIce -= move;
        }
        continue;
      }

      const softLimit = m === MAT.Soil ? 0.05 : FLOW_DOWN;

      // DOWN
      if (y + 1 < rows) {
        const j = idx(x, y + 1, cols);
        const targetMat = g[j];
        if (targetMat === MAT.DrainClean || targetMat === MAT.DrainDirty) {
          const moved = take(i, clean[i] + dirty[i]);
          clean[j] += moved.c;
          dirty[j] += moved.d;
          drainFrom(j, x, y + 1);
          clean[j] = 0;
          dirty[j] = 0;
          continue;
        }
        if (targetMat === MAT.Sponge) {
          const room = Math.max(0, SPONGE_CAPACITY - meta[j].absorbClean - meta[j].absorbDirty);
          const a = Math.min(amountHere, room, SPONGE_ABSORB_RATE);
          if (a > 0) {
            const moved = take(i, a);
            meta[j].absorbClean += moved.c;
            meta[j].absorbDirty += moved.d;
            events.push({ type: 'spongeAbsorb', cell: j, x, y: y + 1, amount: a });
            pressure[i] = Math.max(0, pressure[i] - 0.01);
          }
        } else if (canAccept(j)) {
          const cap = Math.max(0, CELL_CAPACITY - (clean[j] + dirty[j]));
          const move = Math.min(clean[i] + dirty[i], cap, softLimit);
          if (move > 0) {
            const moved = take(i, move);
            put(j, moved.c, moved.d);
            pressure[i] = Math.max(0, pressure[i] - 0.03);
          } else if (amountHere > 0.9) {
            pressure[i] += amountHere * PRESSURE_GAIN * 0.03 * pressureScale;
          }
        } else if (amountHere > 0.9) {
          // Blocked below: the load lands on whatever is holding the water up.
          const load = amountHere * PRESSURE_GAIN * 0.06 * pressureScale;
          pressure[i] += load * 0.35;
          if (targetMat === MAT.Sand || targetMat === MAT.Soil || targetMat === MAT.Pipe) {
            pressure[j] += load;
          }
        }
      } else {
        pressure[i] += 0.005 * pressureScale;
      }

      // LEFT then RIGHT, only while above the neighbour's level.
      if (m !== MAT.Soil) {
        for (const dir of [3, 1] as const) {
          const nx = x + DIR_DX[dir];
          const ny = y + DIR_DY[dir];
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const j = idx(nx, ny, cols);
          const here = clean[i] + dirty[i];
          const there = clean[j] + dirty[j];
          if (there >= here - 1e-6) continue;
          const targetMat = g[j];
          if (targetMat === MAT.Sponge) {
            const room = Math.max(0, SPONGE_CAPACITY - meta[j].absorbClean - meta[j].absorbDirty);
            const a = Math.min(here, room, SPONGE_ABSORB_RATE * 0.6);
            if (a > 0) {
              const moved = take(i, a);
              meta[j].absorbClean += moved.c;
              meta[j].absorbDirty += moved.d;
              events.push({ type: 'spongeAbsorb', cell: j, x: nx, y: ny, amount: a });
            }
            continue;
          }
          if (!canAccept(j)) continue;
          const cap = Math.max(0, CELL_CAPACITY - (clean[j] + dirty[j]));
          const move = Math.min(here, cap, FLOW_SIDE, (here - there) * 0.5);
          if (move > 0) {
            const moved = take(i, move);
            put(j, moved.c, moved.d);
          }
        }
      }
    }
  }

  // --- Mixing pass ---------------------------------------------------------
  for (let i = 0; i < size; i++) {
    const c = clean[i];
    const d = dirty[i];
    if (c > 0.001 && d > 0.001) {
      const mix = Math.min(c, d, 0.06);
      clean[i] -= mix;
      dirty[i] += mix;
      if (tick % 24 === 0) {
        events.push({
          type: 'mix',
          cell: i,
          x: i % cols,
          y: Math.floor(i / cols),
          amount: mix,
          clean: clean[i],
          dirty: dirty[i],
        });
      }
    }
  }

  // --- Pressure decay and structural failure -------------------------------
  for (let i = 0; i < size; i++) {
    pressure[i] *= PRESSURE_DECAY;
    if (pressure[i] < 0.0005) pressure[i] = 0;
  }

  if (destruction) {
    for (let i = 0; i < size; i++) {
      const p = pressure[i];
      if (p < 0.4) continue;
      const m = g[i];
      const x = i % cols;
      const y = Math.floor(i / cols);
      if (m === MAT.Sand && p > PRESSURE_SAND) {
        const vanish = cellHash(tick, i) > 0.55;
        g[i] = vanish ? MAT.Empty : MAT.Soil;
        pressure[i] = 0;
        events.push({ type: 'sandCollapse', cell: i, x, y, amount: p, reason: vanish ? 'vanish' : 'soil' });
      } else if (m === MAT.Soil && p > PRESSURE_SOIL && !meta[i].cracked) {
        meta[i].cracked = true;
        pressure[i] *= 0.35;
        events.push({ type: 'soilCrack', cell: i, x, y, amount: p });
      } else if (m === MAT.Pipe && p > PRESSURE_PIPE) {
        g[i] = MAT.Empty;
        pressure[i] = 0;
        events.push({ type: 'pipeBurst', cell: i, x, y, amount: p });
      } else if (m === MAT.Sponge && p > PRESSURE_SPONGE) {
        const release = meta[i].absorbClean + meta[i].absorbDirty;
        if (release > 0) {
          const cap = Math.max(0, CELL_CAPACITY - (clean[i] + dirty[i]));
          const back = Math.min(release, cap);
          const cShare = release > 0 ? back * (meta[i].absorbClean / release) : 0;
          meta[i].absorbClean = Math.max(0, meta[i].absorbClean - cShare);
          meta[i].absorbDirty = Math.max(0, meta[i].absorbDirty - (back - cShare));
          clean[i] += cShare;
          dirty[i] += back - cShare;
          events.push({ type: 'spongeRelease', cell: i, x, y, amount: back });
        }
        pressure[i] = 0;
      }
    }
  }

  // --- Overflow above the top row ------------------------------------------
  for (let x = 0; x < cols; x++) {
    const i = idx(x, 0, cols);
    const m = g[i];
    if (m !== MAT.Empty && m !== MAT.Filter) continue;
    const total = clean[i] + dirty[i];
    if (total < 0.98) continue;
    let belowBlocked = true;
    if (rows > 1) {
      const j = idx(x, 1, cols);
      const below = clean[j] + dirty[j];
      belowBlocked = !canAccept(j) || below >= CELL_CAPACITY - 0.001;
    }
    if (!belowBlocked) continue;
    const spill = Math.min(total, 0.012);
    const cSpill = total > 0 ? spill * (clean[i] / total) : 0;
    clean[i] -= cSpill;
    dirty[i] -= spill - cSpill;
    overflowed += spill;
    events.push({ type: 'overflow', cell: i, x, y: 0, amount: spill, clean: cSpill, dirty: spill - cSpill });
  }

  return {
    water: { clean, dirty },
    pressure,
    grid: g,
    meta,
    events,
    overflowed,
    drainedClean,
    drainedDirty,
    pollution,
    wasted,
    filterClogs,
    drainClean,
    drainDirty,
  };
}

/**
 * Preview N steps of flow without landing a block. Pure; used by the
 * 3-step water preview. Cheap enough for a 10x16 grid at 60 fps UI rate.
 */
export function previewFlow(
  grid: Uint8Array,
  water: WaterField,
  tick: number,
  config: SimOptions,
  steps = 3,
  ticksPerStep = 10,
): { clean: Float64Array; dirty: Float64Array; steps: number; topRow: number[] } {
  let w: WaterField = { clean: new Float64Array(water.clean), dirty: new Float64Array(water.dirty) };
  let g = new Uint8Array(grid);
  let meta = cloneMeta(config.meta, grid.length);
  let pressure = new Float64Array(config.pressure ?? new Float64Array(grid.length));
  for (let s = 0; s < steps; s++) {
    for (let t = 0; t < ticksPerStep; t++) {
      const r = simulate(g, w, tick + s * ticksPerStep + t, {
        ...config,
        meta,
        pressure,
        pressureScale: (config.pressureScale ?? 1) * 0.6,
        destruction: false,
      });
      w = r.water;
      g = r.grid;
      meta = r.meta;
      pressure = r.pressure;
    }
  }
  const topRow = new Array<number>(config.cols).fill(config.rows);
  for (let x = 0; x < config.cols; x++) {
    for (let y = 0; y < config.rows; y++) {
      const i = y * config.cols + x;
      if (w.clean[i] + w.dirty[i] > 0.02) {
        topRow[x] = y;
        break;
      }
    }
  }
  return { clean: w.clean, dirty: w.dirty, steps, topRow };
}
