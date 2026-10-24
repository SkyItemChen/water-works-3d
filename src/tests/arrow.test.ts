
/**
 * The direction arrow must be drawn, and must point the way water flows.
 *
 * The bug this guards: pipes and valves were rendered as a cube with
 * `rotation.z = dir * 90deg`. A rotated cube looks identical to an unrotated
 * one, so the guide promised "water follows the arrow" while the screen showed
 * no arrow at all — the player could not tell which way a conduit pushed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VoxelRenderer, type VoxelFrame } from '../game/three/VoxelRenderer';
import { BLOCKS } from '../game/core/bag';
import { ALL_BLOCK_KINDS } from '../game/core/bag';
import { arrowQuarterTurns, BLOCK_GUIDE_LIST } from '../game/core/blockGuide';
import { MAT } from '../game/core/types';

const COLS = 10;
const ROWS = 16;

function frameWith(cells: { x: number; y: number; mat: number; dir: number }[], over: Partial<VoxelFrame> = {}): VoxelFrame {
  const n = COLS * ROWS;
  const grid = new Uint8Array(n);
  const meta = Array.from({ length: n }, () => ({ dir: 2, absorbClean: 0, absorbDirty: 0, clog: 0, cracked: false }));
  for (const c of cells) {
    const i = c.y * COLS + c.x;
    grid[i] = c.mat;
    meta[i].dir = c.dir;
  }
  return {
    cols: COLS,
    rows: ROWS,
    grid,
    clean: new Float64Array(n),
    dirty: new Float64Array(n),
    pressure: new Float64Array(n),
    meta,
    piece: null,
    ghostY: 0,
    showPreview: false,
    dangerCols: [],
    time: 0,
    ...over,
  };
}

/** The z depth each arrow instance was drawn at. */
function arrowDepths(mesh: THREE.InstancedMesh): number[] {
  const m = new THREE.Matrix4();
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(m.elements[14]);
  }
  return out;
}

/** Which way does each arrow instance actually point, in degrees clockwise from up? */
function arrowAngles(mesh: THREE.InstancedMesh): number[] {
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    const dir = up.clone().applyMatrix4(new THREE.Matrix4().extractRotation(m)).normalize();
    // 0 = up, 90 = right, 180 = down, 270 = left (screen convention).
    const deg = (Math.atan2(dir.x, dir.y) * 180) / Math.PI;
    out.push(((Math.round(deg) % 360) + 360) % 360);
  }
  return out;
}

describe('conduits draw a direction arrow', () => {
  it('draws one arrow for every pipe and valve on the board', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    vr.update(frameWith([]));
    expect(vr.arrowMesh.count).toBe(0);

    vr.update(
      frameWith([
        { x: 1, y: 4, mat: MAT.Pipe, dir: 2 },
        { x: 2, y: 4, mat: MAT.Valve, dir: 2 },
        { x: 3, y: 4, mat: MAT.Sponge, dir: 2 }, // not a conduit
        { x: 4, y: 4, mat: MAT.Soil, dir: 2 }, // not a conduit
      ]),
    );
    expect(vr.arrowMesh.count).toBe(2);
    vr.dispose();
  });

  it('points the arrow the way the water actually flows, for all four dirs', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    // 0 up, 1 right, 2 down, 3 left
    vr.update(
      frameWith([
        { x: 1, y: 4, mat: MAT.Pipe, dir: 0 },
        { x: 2, y: 4, mat: MAT.Pipe, dir: 1 },
        { x: 3, y: 4, mat: MAT.Pipe, dir: 2 },
        { x: 4, y: 4, mat: MAT.Pipe, dir: 3 },
      ]),
    );
    expect(vr.arrowMesh.count).toBe(4);
    // Instances are emitted in grid scan order, which is column order here.
    expect(arrowAngles(vr.arrowMesh)).toEqual([0, 90, 180, 270]);
    vr.dispose();
  });

  it('shows the arrow on the active falling pipe, before it locks', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    vr.update(
      frameWith([], {
        piece: { cells: [{ x: 0, y: 0 }], x: 3, y: 2, color: '#9aa7b4', kind: 'pipe', dir: 1 },
      }),
    );
    expect(vr.arrowMesh.count).toBe(1);
    expect(arrowAngles(vr.arrowMesh)).toEqual([90]);
    vr.dispose();
  });

  it('rotating a falling pipe moves its arrow', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    const piece = (dir: number): VoxelFrame =>
      frameWith([], { piece: { cells: [{ x: 0, y: 0 }], x: 3, y: 2, color: '#9aa7b4', kind: 'pipe', dir } });

    vr.update(piece(2));
    const down = arrowAngles(vr.arrowMesh)[0];
    vr.update(piece(3));
    const left = arrowAngles(vr.arrowMesh)[0];
    // A cube rotated by 90° looks the same; an arrow must not.
    expect(down).not.toBe(left);
    expect([down, left]).toEqual([180, 270]);
    vr.dispose();
  });

  it('a pipe that just spawned keeps its arrow in front of its own body', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    // spawn() parks the lowest cell on row 0, so this is the first frame the
    // player ever sees of the piece -- the arrow must already be readable.
    vr.update(
      frameWith([], {
        piece: { cells: [{ x: 0, y: 0 }], x: 4, y: 0, color: '#9aa7b4', kind: 'pipe', dir: 2 },
      }),
    );
    expect(vr.arrowMesh.count).toBe(1);
    // The piece slab is 0.88 deep at z 0.28, so its front face is at 0.72. An
    // arrow drawn any shallower is inside the block and gets depth-culled.
    expect(arrowDepths(vr.arrowMesh)[0]).toBeGreaterThan(0.72);
    vr.dispose();
  });

  it('keeps the arrow on a conduit while a hard drop is in flight', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    const drop = (kind: 'pipe' | 'valve' | 'sand', dir?: number) => [
      { fromY: 0, toY: 10, x: 3, cells: [{ x: 0, y: 0 }], color: '#9aa7b4', kind, dir, age: 0.2 },
    ];

    vr.update(frameWith([], { dropTrails: drop('pipe', 3) }));
    expect(vr.arrowMesh.count).toBe(1);
    expect(arrowAngles(vr.arrowMesh)).toEqual([270]);
    // The flying slab sits at z 0.34 with a 0.88 depth (face 0.78).
    expect(arrowDepths(vr.arrowMesh)[0]).toBeGreaterThan(0.78);

    // A block without a direction still gets no arrow.
    vr.update(frameWith([], { dropTrails: drop('sand') }));
    expect(vr.arrowMesh.count).toBe(0);
    vr.dispose();
  });

  it('no arrow on blocks that have no direction', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    vr.update(
      frameWith([], {
        piece: { cells: [{ x: 0, y: 0 }], x: 3, y: 2, color: '#8a5a3b', kind: 'soil2', dir: 2 },
      }),
    );
    expect(vr.arrowMesh.count).toBe(0);
    vr.dispose();
  });
});

describe('arrow angle convention is shared', () => {
  it('arrowQuarterTurns maps the four dirs to the four quarter turns', () => {
    // The drawn arrow points up at 0deg, so dir is already the turn count.
    expect(arrowQuarterTurns(0)).toBe(0); // up
    expect(arrowQuarterTurns(1)).toBe(1); // right
    expect(arrowQuarterTurns(2)).toBe(2); // down
    expect(arrowQuarterTurns(3)).toBe(3); // left
    // Stable for out-of-range input, so a bad level file cannot spin the arrow.
    expect(arrowQuarterTurns(-1)).toBe(3);
    expect(arrowQuarterTurns(7)).toBe(3);
    expect(arrowQuarterTurns(4)).toBe(0);
  });

  it('every conduit in the codex carries an arrow, and nothing else does', () => {
    for (const entry of BLOCK_GUIDE_LIST) {
      const conduit = entry.kind === 'pipe' || entry.kind === 'valve';
      expect(entry.arrow !== undefined, entry.kind).toBe(conduit);
      if (conduit) {
        expect(entry.arrow).toBe(arrowQuarterTurns(BLOCKS[entry.kind].dir ?? 2));
      }
    }
  });

  it('the block catalogue still gives conduits a direction', () => {
    for (const kind of ALL_BLOCK_KINDS) {
      const isConduit = kind === 'pipe' || kind === 'valve';
      expect(BLOCKS[kind].dir !== undefined, kind).toBe(isConduit);
    }
  });
});
