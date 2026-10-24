/**
 * InstancedMesh voxel renderer.
 *
 * Everything static (soil, sand, sponge, pipe, valve, filter, drains, ice) is
 * drawn with one InstancedMesh. Water is a second InstancedMesh of
 * semi-transparent boxes whose height encodes the 0..1 fill level. Two more
 * small instanced meshes draw the falling piece and its ghost.
 *
 * Per-cell colour variation is computed on the CPU and written to the instance
 * colour buffer. No geometry is allocated per frame.
 */

import * as THREE from 'three';
import { MATERIAL_COLORS } from '../core/constants';
import { MAT } from '../core/types';

export interface VoxelFrame {
  cols: number;
  rows: number;
  grid: Uint8Array;
  clean: Float64Array;
  dirty: Float64Array;
  pressure: Float64Array;
  meta: {
    dir: number;
    absorbClean: number;
    absorbDirty: number;
    clog: number;
    cracked: boolean;
  }[];
  piece: {
    cells: { x: number; y: number }[];
    x: number;
    y: number;
    color: string;
    kind: string;
    /** pipe/valve direction, so the active piece can show its arrow too */
    dir?: number;
  } | null;
  ghostY: number;
  previewClean?: Float64Array | null;
  previewDirty?: Float64Array | null;
  showPreview: boolean;
  dangerCols: number[];
  time: number;
  /** cells that are actively mixing this frame, for emissive pulse */
  mixCells?: number[];
  /**
   * In-flight hard drops: a fast fall drawn on top of the already-locked block
   * so pressing space reads as a slam rather than a teleport. `age` is 0..1,
   * 1 meaning finished.
   */
  dropTrails?: {
    fromY: number;
    toY: number;
    x: number;
    cells: { x: number; y: number }[];
    color: string;
    kind: string;
    dir?: number;
    age: number;
  }[];
}

/**
 * Arrow depths, one per drawn layer. Each value must clear the front face of
 * the slab it sits on, or that slab's depth write hides the arrow: a board cell
 * is a 0.9-deep box centred at z 0 (face 0.45), the falling piece is a
 * 0.88-deep box at z 0.28 (face 0.72), the hard-drop overlay is the same box at
 * z 0.34 (face 0.78).
 */
const ARROW_Z = {
  board: 0.56,
  piece: 0.78,
  trail: 0.84,
} as const;

const MAX_INSTANCES = 4096;

/**
 * Flat arrow pointing along +Y, centred on the origin.
 *
 * Built once and reused by every pipe/valve instance: a shaft with a wide head,
 * in the XY plane the board lives in, so it reads as a direction from the front
 * view without needing any depth.
 */
function makeArrowGeometry(): THREE.BufferGeometry {
  // Chunky chevron: head plus a shaft wide enough to survive a 1x screen.
  // A thin arrow reads as a stray line on a 0.88-wide voxel and is worse than
  // useless — the player still cannot tell which way the conduit pushes.
  const shaftHalf = 0.1;
  const headHalf = 0.3;
  const headBottom = 0.08;
  const tip = 0.4;
  const tail = -0.36;
  const shape = new THREE.Shape();
  shape.moveTo(-shaftHalf, tail);
  shape.lineTo(shaftHalf, tail);
  shape.lineTo(shaftHalf, headBottom);
  shape.lineTo(headHalf, headBottom);
  shape.lineTo(0, tip);
  shape.lineTo(-headHalf, headBottom);
  shape.lineTo(-shaftHalf, headBottom);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

const CLEAN_COLOR = new THREE.Color(0x2fbdf5);
const DIRTY_COLOR = new THREE.Color(0x6f7a33);
const MIX_COLOR = new THREE.Color(0x42c98a);

export class VoxelRenderer {
  readonly group = new THREE.Group();

  readonly solid: THREE.InstancedMesh;
  readonly water: THREE.InstancedMesh;
  readonly pieceMesh: THREE.InstancedMesh;
  readonly ghostMesh: THREE.InstancedMesh;
  readonly previewMesh: THREE.InstancedMesh;
  /** Ghost-streak mesh for hard drops in flight. */
  readonly trailMesh: THREE.InstancedMesh;
  /**
   * Direction arrows for pipes and one-way valves.
   *
   * A cube rotated by 90° looks identical to the unrotated cube, so "rotate the
   * pipe" was invisible: the rules changed but the screen did not. This mesh is
   * the only thing that tells the player which way a conduit pushes water.
   */
  readonly arrowMesh: THREE.InstancedMesh;

  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private tmpColor = new THREE.Color();
  // Front view: cubes almost touch, so a small gap is what separates one cell
  // from the next. Depth is a touch shorter than width so the top face sliver
  // stays thin and the grid keeps reading as a rectangle.
  private boxGeo = new THREE.BoxGeometry(0.96, 0.96, 0.9);
  private waterGeo = new THREE.BoxGeometry(0.9, 1, 0.84);
  private pieceGeo = new THREE.BoxGeometry(0.92, 0.92, 0.88);
  private ghostGeo = new THREE.BoxGeometry(0.86, 0.86, 0.14);
  /** Flat arrow, pointing +Y locally; the cell's `dir` rotates it into place. */
  private arrowGeo = makeArrowGeometry();

  private cols = 10;
  private rows = 16;

  constructor() {
    const solidMat = new THREE.MeshStandardMaterial({
      roughness: 0.82,
      metalness: 0.08,
      flatShading: true,
    });
    this.solid = new THREE.InstancedMesh(this.boxGeo, solidMat, MAX_INSTANCES);
    this.solid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.solid.count = 0;
    this.solid.frustumCulled = false;

    const waterMat = new THREE.MeshPhysicalMaterial({
      transparent: true,
      opacity: 0.8,
      roughness: 0.16,
      metalness: 0.0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
      emissive: 0x0d3d55,
      emissiveIntensity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.water = new THREE.InstancedMesh(this.waterGeo, waterMat, MAX_INSTANCES);
    this.water.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.water.count = 0;
    this.water.frustumCulled = false;
    this.water.renderOrder = 4;

    const previewMat = new THREE.MeshBasicMaterial({
      color: 0x9be8ff,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.previewMesh = new THREE.InstancedMesh(this.waterGeo, previewMat, MAX_INSTANCES);
    this.previewMesh.count = 0;
    this.previewMesh.frustumCulled = false;
    this.previewMesh.renderOrder = 3;

    const pieceMat = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.22,
      emissive: 0x223344,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.97,
    });
    this.pieceMesh = new THREE.InstancedMesh(this.pieceGeo, pieceMat, 64);
    this.pieceMesh.count = 0;
    this.pieceMesh.frustumCulled = false;
    this.pieceMesh.renderOrder = 5;

    const ghostMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    this.ghostMesh = new THREE.InstancedMesh(this.ghostGeo, ghostMat, 64);
    this.ghostMesh.count = 0;
    this.ghostMesh.frustumCulled = false;
    this.ghostMesh.renderOrder = 2;

    const trailMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.trailMesh = new THREE.InstancedMesh(this.pieceGeo, trailMat, 256);
    this.trailMesh.count = 0;
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 6;

    // Near-black reads on both the pale blue pipe and the amber valve.
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0x08131b,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.arrowMesh = new THREE.InstancedMesh(this.arrowGeo, arrowMat, MAX_INSTANCES);
    this.arrowMesh.count = 0;
    this.arrowMesh.frustumCulled = false;
    // In front of the voxel slabs (z up to ~0.45) so it is never depth-culled.
    this.arrowMesh.renderOrder = 7;

    this.group.add(this.previewMesh, this.solid, this.water, this.ghostMesh, this.pieceMesh, this.trailMesh, this.arrowMesh);
  }

  setGrid(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  private worldPos(x: number, y: number): { px: number; py: number } {
    return {
      px: x - (this.cols - 1) / 2,
      py: (this.rows - 1) / 2 - y,
    };
  }

  update(frame: VoxelFrame): void {
    const cols = frame.cols;
    const rows = frame.rows;
    if (cols !== this.cols || rows !== this.rows) this.setGrid(cols, rows);
    const t = frame.time;

    // --- Solids --------------------------------------------------------------
    let sCount = 0;
    let ac = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const m = frame.grid[i];
        if (m === MAT.Empty) continue;
        if (sCount >= MAX_INSTANCES) break;
        const { px, py } = this.worldPos(x, y);
        const meta = frame.meta[i];

        this.dummy.position.set(px, py, 0);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);

        if (m === MAT.DrainClean || m === MAT.DrainDirty) {
          // Recessed slightly so the socket reads as an opening in the floor,
          // but still in front of the backing plate (whose face is at z = -0.57).
          this.dummy.position.z = -0.12;
          this.dummy.scale.set(0.97, 0.97, 0.5);
        } else if (m === MAT.Pipe || m === MAT.Valve) {
          this.dummy.scale.set(0.88, 0.88, 0.88);
          this.dummy.rotation.z = (meta.dir * Math.PI) / 2;
        } else if (m === MAT.Sand) {
          const p = Math.min(1, frame.pressure[i]);
          this.dummy.scale.set(1 - p * 0.05, 1 - p * 0.07, 1 - p * 0.05);
        } else if (m === MAT.Sponge) {
          const soak = Math.min(1, (meta.absorbClean + meta.absorbDirty) / 2);
          this.dummy.scale.set(1 + soak * 0.05, 1 - soak * 0.06, 1 + soak * 0.05);
        } else if (m === MAT.Filter) {
          const clog = Math.min(1, meta.clog / 3);
          this.dummy.scale.set(1 - clog * 0.08, 1 - clog * 0.05, 1 - clog * 0.08);
        } else if (m === MAT.Soil && meta.cracked) {
          this.dummy.scale.set(0.98, 0.98, 0.98);
        }
        this.dummy.updateMatrix();
        this.solid.setMatrixAt(sCount, this.dummy.matrix);

        this.pickSolidColor(m, meta, frame, i, t);
        this.solid.setColorAt(sCount, this.color);
        sCount++;

        // Pipes and valves carry a direction the cube shape cannot show.
        if (m === MAT.Pipe || m === MAT.Valve) {
          this.arrowAt(ac, px, py, meta.dir, m === MAT.Valve ? 1.0 : 0.92);
          ac++;
        }
      }
    }
    this.solid.count = sCount;
    this.solid.instanceMatrix.needsUpdate = true;
    if (this.solid.instanceColor) this.solid.instanceColor.needsUpdate = true;

    // --- Water ---------------------------------------------------------------
    let wCount = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const c = frame.clean[i];
        const d = frame.dirty[i];
        const total = c + d;
        if (total <= 0.004) continue;
        if (wCount >= MAX_INSTANCES) break;
        const { px, py } = this.worldPos(x, y);
        const h = Math.max(0.05, Math.min(1, total));

        this.dummy.position.set(px, py - (1 - h) * 0.5, 0.05);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(0.95, h, 0.95);
        this.dummy.updateMatrix();
        this.water.setMatrixAt(wCount, this.dummy.matrix);

        this.pickWaterColor(c, d, t, i);
        this.water.setColorAt(wCount, this.color);
        wCount++;
      }
    }
    this.water.count = wCount;
    this.water.instanceMatrix.needsUpdate = true;
    if (this.water.instanceColor) this.water.instanceColor.needsUpdate = true;

    // --- Flow preview --------------------------------------------------------
    let pCount = 0;
    if (frame.showPreview && frame.previewClean && frame.previewDirty) {
      for (let i = 0; i < cols * rows; i++) {
        const total = (frame.previewClean[i] ?? 0) + (frame.previewDirty[i] ?? 0);
        if (total <= 0.03) continue;
        if (pCount >= MAX_INSTANCES) break;
        const x = i % cols;
        const y = Math.floor(i / cols);
        const { px, py } = this.worldPos(x, y);
        const h = Math.max(0.06, Math.min(1, total));
        this.dummy.position.set(px, py - (1 - h) * 0.5, 0.1);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(0.88, h, 0.88);
        this.dummy.updateMatrix();
        this.previewMesh.setMatrixAt(pCount++, this.dummy.matrix);
      }
    }
    this.previewMesh.count = pCount;
    this.previewMesh.instanceMatrix.needsUpdate = true;

    // --- Active piece + ghost ------------------------------------------------
    let pc = 0;
    let gc = 0;
    if (frame.piece) {
      const { cells, x: px0, y: py0 } = frame.piece;
      this.color.set(frame.piece.color);
      const pulse = 1 + Math.sin(t * 6) * 0.02;
      for (const cell of cells) {
        const gx = px0 + cell.x;
        const gy = py0 + cell.y;
        // A piece spawns with its upper cells above row 0. The front framing
        // reserves headroom there, so draw them instead of hiding them.
        if (gy < -2) continue;
        const { px, py } = this.worldPos(gx, gy);
        this.dummy.position.set(px, py, 0.28);
        this.dummy.scale.setScalar(pulse);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.pieceMesh.setMatrixAt(pc, this.dummy.matrix);
        this.pieceMesh.setColorAt(pc, this.color);
        pc++;
      }
      // The active piece must show its direction as well: a pipe is only
      // rotatable *before* it locks, so the player has to see the arrow while
      // it is falling. Only 1x1 conduits have a meaningful direction.
      if ((frame.piece.kind === 'pipe' || frame.piece.kind === 'valve') && frame.piece.dir !== undefined) {
        const gx = px0 + cells[0].x;
        const gy = py0 + cells[0].y;
        if (gy >= -2) {
          const { px, py } = this.worldPos(gx, gy);
          this.arrowAt(ac++, px, py, frame.piece.dir, frame.piece.kind === 'valve' ? 1.0 : 0.92, ARROW_Z.piece);
        }
      }

      const ghostY = frame.ghostY;
      for (const cell of cells) {
        const gx = px0 + cell.x;
        const gy = ghostY + cell.y;
        if (gy < 0) continue;
        const { px, py } = this.worldPos(gx, gy);
        // In a front view the ghost must sit in front of the voxel slabs to be
        // readable, otherwise it hides behind whatever is already placed.
        this.dummy.position.set(px, py, 0.52);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.ghostMesh.setMatrixAt(gc, this.dummy.matrix);
        this.ghostMesh.setColorAt(gc, this.color);
        gc++;
      }
    }
    this.pieceMesh.count = pc;
    this.pieceMesh.instanceMatrix.needsUpdate = true;
    if (this.pieceMesh.instanceColor) this.pieceMesh.instanceColor.needsUpdate = true;
    this.ghostMesh.count = gc;
    this.ghostMesh.instanceMatrix.needsUpdate = true;
    if (this.ghostMesh.instanceColor) this.ghostMesh.instanceColor.needsUpdate = true;

    // --- Hard-drop trail -----------------------------------------------------
    // The rules lock the piece on the tick space is pressed, so the settled
    // block is already in the grid by the time this frame is drawn. Without an
    // overlay the slam looks like a teleport. Instead, fly the piece itself down
    // the span it covered, with a short streak behind it, over a fraction of a
    // second: that reads as "the block was slammed down".
    let tc = 0;
    const trails = frame.dropTrails;
    if (trails && trails.length) {
      for (const trail of trails) {
        if (trail.age >= 1) continue;
        const ease = trail.age * trail.age; // accelerate: a slam speeds up
        const span = trail.toY - trail.fromY;
        const rowNow = trail.fromY + span * ease;
        this.color.set(trail.color);
        // Streak: a couple of ghosts trailing above the flying piece.
        for (let k = 1; k <= 3; k++) {
          const row = rowNow - k * 0.9;
          if (row < trail.fromY - 1) break;
          for (const cell of trail.cells) {
            if (tc >= 256) break;
            const gy = Math.round(row) + cell.y;
            if (gy < -2) continue;
            const { px, py } = this.worldPos(trail.x + cell.x, gy);
            this.dummy.position.set(px, py, 0.3);
            this.dummy.rotation.set(0, 0, 0);
            this.dummy.scale.set(1, 0.7, 1);
            this.dummy.updateMatrix();
            this.trailMesh.setMatrixAt(tc, this.dummy.matrix);
            this.color.set(trail.color).multiplyScalar(0.55 / k);
            this.trailMesh.setColorAt(tc, this.color);
            tc++;
          }
        }
        // The flying piece itself: full size, full colour.
        for (const cell of trail.cells) {
          if (tc >= 256) break;
          const gy = Math.round(rowNow) + cell.y;
          if (gy < -2) continue;
          const { px, py } = this.worldPos(trail.x + cell.x, gy);
          this.dummy.position.set(px, py, 0.34);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          this.trailMesh.setMatrixAt(tc, this.dummy.matrix);
          this.color.set(trail.color);
          this.trailMesh.setColorAt(tc, this.color);
          tc++;
        }
        // A conduit keeps its arrow while it is in the air. The rules lock the
        // piece on the same tick the drop is issued, so the board cell that
        // shows the arrow is already behind this overlay: without drawing it
        // here the arrow vanishes for the whole slam.
        if ((trail.kind === 'pipe' || trail.kind === 'valve') && trail.dir !== undefined) {
          const gy = Math.round(rowNow) + trail.cells[0].y;
          if (gy >= -2) {
            const { px, py } = this.worldPos(trail.x + trail.cells[0].x, gy);
            this.arrowAt(
              ac++,
              px,
              py,
              trail.dir,
              trail.kind === 'valve' ? 1.0 : 0.92,
              ARROW_Z.trail,
            );
          }
        }
      }
    }
    this.trailMesh.count = tc;
    this.trailMesh.instanceMatrix.needsUpdate = true;
    if (this.trailMesh.instanceColor) this.trailMesh.instanceColor.needsUpdate = true;

    // Flushed last: the hard-drop loop above appends arrows too.
    this.arrowMesh.count = ac;
    this.arrowMesh.instanceMatrix.needsUpdate = true;
  }

  private pickSolidColor(
    m: number,
    meta: { absorbClean: number; absorbDirty: number; clog: number; cracked: boolean },
    frame: VoxelFrame,
    i: number,
    t: number,
  ): void {
    this.color.setHex(MATERIAL_COLORS[m] ?? 0x8899aa);
    if (m === MAT.Soil) {
      if (meta.cracked) this.color.offsetHSL(0, -0.1, -0.14);
    } else if (m === MAT.Sponge) {
      const soak = Math.min(1, (meta.absorbClean + meta.absorbDirty) / 2);
      this.color.lerp(this.tmpColor.setHex(0x74c7ff), soak * 0.55);
    } else if (m === MAT.Filter) {
      const clog = Math.min(1, meta.clog / 3);
      this.color.lerp(this.tmpColor.setHex(0x54431f), clog * 0.8);
    } else if (m === MAT.DrainClean) {
      const pulse = 0.8 + Math.sin(t * 2.6) * 0.2;
      this.color.multiplyScalar(pulse);
    } else if (m === MAT.DrainDirty) {
      this.color.multiplyScalar(0.85 + Math.sin(t * 1.9) * 0.1);
    } else if (m === MAT.Pipe || m === MAT.Valve) {
      this.color.multiplyScalar(0.92 + Math.sin(t * 1.3 + i * 0.4) * 0.06);
    } else if (m === MAT.Sand) {
      const p = Math.min(1, frame.pressure[i]);
      this.color.lerp(this.tmpColor.setHex(0xff8a5a), p * 0.5);
    }
    // Front view puts every cell's front face at the same depth and normal, so
    // lighting alone would flatten the board into one wall. A deterministic
    // per-cell luminance jitter restores the voxel read: neighbouring cubes of
    // the same material still look like separate blocks.
    if (m !== MAT.DrainClean && m !== MAT.DrainDirty) {
      const jitter = 0.9 + (((i * 73) % 17) / 17) * 0.2;
      this.color.multiplyScalar(jitter);
    }
    if (frame.dangerCols.indexOf(i % frame.cols) >= 0) {
      this.color.lerp(this.tmpColor.setHex(0xff5a5a), 0.16);
    }
  }

  /**
   * Place one arrow: `dir` is the water direction (0 up, 1 right, 2 down, 3 left)
   * and the arrow geometry points +Y by default.
   */
  private arrowAt(
    index: number,
    px: number,
    py: number,
    dir: number,
    scale: number,
    z: number = ARROW_Z.board,
  ): void {
    if (index >= MAX_INSTANCES) return;
    // Screen Y grows downward while world Y grows upward; a clockwise rotation
    // of `dir * 90°` about Z maps +Y onto the right/left/down directions.
    // `z` is the caller's layer depth; see ARROW_Z.
    this.dummy.position.set(px, py, z);
    this.dummy.rotation.set(0, 0, -(dir * Math.PI) / 2);
    this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    this.arrowMesh.setMatrixAt(index, this.dummy.matrix);
  }

  private pickWaterColor(c: number, d: number, t: number, i: number): void {
    const total = c + d;
    if (total <= 0) return;
    const ratio = d / total;
    if (ratio < 0.02) {
      this.color.copy(CLEAN_COLOR);
      const shimmer = Math.sin(t * 2.2 + i * 0.63) * 0.06;
      this.color.offsetHSL(0, 0, shimmer);
    } else if (ratio > 0.98) {
      this.color.copy(DIRTY_COLOR);
      this.color.offsetHSL(0, 0, Math.sin(t * 1.5 + i) * 0.035);
    } else {
      // Mixed cell: teal-green transition + shimmer = "clean meets dirty".
      this.color.copy(CLEAN_COLOR).lerp(DIRTY_COLOR, ratio);
      this.color.lerp(MIX_COLOR, 0.55);
      this.color.offsetHSL(0, 0.12, 0.02);
      const shimmer = 0.5 + 0.5 * Math.sin(t * 3.6 + i * 1.17);
      this.color.offsetHSL(0.01 * shimmer, 0.06, 0.07 * shimmer);
    }
  }

  dispose(): void {
    this.boxGeo.dispose();
    this.waterGeo.dispose();
    this.pieceGeo.dispose();
    this.ghostGeo.dispose();
    this.arrowGeo.dispose();
    const mats = [
      this.solid.material,
      this.water.material,
      this.previewMesh.material,
      this.pieceMesh.material,
      this.ghostMesh.material,
      this.trailMesh.material,
      this.arrowMesh.material,
    ];
    for (const m of mats) (m as THREE.Material).dispose();
    this.group.clear();
  }
}
