
/**
 * The hard-drop trail must actually reach the renderer.
 *
 * A hard drop is one tick in the rules (the block is already in the grid by the
 * time the frame is drawn), so the only thing that makes it look like a slam is
 * the trail mesh. These tests read the instance data the renderer produces, so
 * a trail that silently renders nothing fails here instead of looking "fine".
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VoxelRenderer, type VoxelFrame } from '../game/three/VoxelRenderer';
import { DropTrails } from '../game/three/DropTrails';
import type { HardDropFx } from '../game/core/types';

const COLS = 10;
const ROWS = 16;

function blankFrame(over: Partial<VoxelFrame> = {}): VoxelFrame {
  const n = COLS * ROWS;
  return {
    cols: COLS,
    rows: ROWS,
    grid: new Uint8Array(n),
    clean: new Float64Array(n),
    dirty: new Float64Array(n),
    pressure: new Float64Array(n),
    meta: Array.from({ length: n }, () => ({ dir: 2, absorbClean: 0, absorbDirty: 0, clog: 0, cracked: false })),
    piece: null,
    ghostY: 0,
    showPreview: false,
    dangerCols: [],
    time: 0,
    ...over,
  };
}

/** Vertical centre (world units) of every instance in a mesh. */
function instanceRows(mesh: THREE.InstancedMesh): number[] {
  const m = new THREE.Matrix4();
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(m.elements[13]);
  }
  return out;
}

const DROP: HardDropFx = {
  t: 5,
  x: 3,
  fromY: 1,
  toY: 11,
  cells: [{ x: 0, y: 0 }],
  color: '#8a5a3b',
  kind: 'sand',
};

describe('hard-drop trail reaches the renderer', () => {
  it('flies the piece down the span it covered, not just a static row', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    vr.update(blankFrame());
    expect(vr.trailMesh.count).toBe(0);

    const trailAt = (age: number) =>
      ([{ fromY: 1, toY: 11, x: 3, cells: [{ x: 0, y: 0 }], color: '#8a5a3b', kind: 'sand' as const, age }]);

    // Early in the slam the block is still near where it started...
    vr.update(blankFrame({ dropTrails: trailAt(0.1) }));
    const early = Math.max(...instanceRows(vr.trailMesh));
    expect(vr.trailMesh.count).toBeGreaterThan(0);

    // ...and by the end it has travelled most of the way down. That travel is
    // the whole point: without it the slam reads as a teleport.
    vr.update(blankFrame({ dropTrails: trailAt(0.95) }));
    const late = Math.max(...instanceRows(vr.trailMesh));
    expect(early - late).toBeGreaterThan(5);

    // Everything stays inside the board's vertical extent.
    const topRow = (ROWS - 1) / 2;
    const bottomRow = (ROWS - 1) / 2 - 11;
    for (const y of instanceRows(vr.trailMesh)) {
      expect(y).toBeLessThanOrEqual(topRow + 1.01);
      expect(y).toBeGreaterThanOrEqual(bottomRow - 2.01);
    }
    vr.dispose();
  });

  it('fades with age and disappears at age 1', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    const trail = (age: number) =>
      ([{ fromY: 1, toY: 9, x: 3, cells: [{ x: 0, y: 0 }], color: '#8a5a3b', kind: 'sand' as const, age }]);

    vr.update(blankFrame({ dropTrails: trail(0) }));
    const fresh = vr.trailMesh.count;
    expect(fresh).toBeGreaterThan(0);

    vr.update(blankFrame({ dropTrails: trail(0.5) }));
    expect(vr.trailMesh.count).toBeGreaterThan(0);

    vr.update(blankFrame({ dropTrails: trail(1) }));
    expect(vr.trailMesh.count).toBe(0);
    vr.dispose();
  });

  it('never overruns its instance budget on a full-height slam', () => {
    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    const cells = [
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    ];
    const drops = Array.from({ length: 6 }, (_, i) => ({
      fromY: 0, toY: ROWS + 9, x: i, cells, color: '#8a5a3b', kind: 'sand' as const, age: 0.2,
    }));
    vr.update(blankFrame({ dropTrails: drops }));
    expect(vr.trailMesh.count).toBeLessThanOrEqual(256);
    expect(vr.trailMesh.count).toBeGreaterThan(0);
    vr.dispose();
  });

  it('end to end: engine log -> DropTrails -> frame -> mesh', () => {
    const trails = new DropTrails();
    const cursor = { value: 0 };
    trails.sync([DROP], cursor);
    trails.update(0.02);
    const frame = trails.frame();
    expect(frame.length).toBe(1);
    expect(frame[0].age).toBeGreaterThan(0);
    expect(frame[0].age).toBeLessThan(1);

    const vr = new VoxelRenderer();
    vr.setGrid(COLS, ROWS);
    vr.update(blankFrame({ dropTrails: frame }));
    expect(vr.trailMesh.count).toBeGreaterThan(1);
    vr.dispose();
  });
});
