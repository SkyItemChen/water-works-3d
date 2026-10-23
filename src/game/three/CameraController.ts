/**
 * Camera rig for the FRONT-FACING voxel view.
 *
 * The board plane is XY (x = column, y = row, z = depth), so a front view means
 * the camera sits on the +Z axis looking towards -Z. The default azimuth is
 * therefore PI/2 (not 0, which would look at the board edge-on) and the default
 * elevation is a small tilt: enough to see the top sliver of every cube, small
 * enough that the grid still reads as a straight rectangle.
 *
 * Free orbiting is clamped to a narrow band around the front so the board can
 * never be dragged back into a skewed isometric projection. Zoom stays free.
 * The cinematic beats (fly-in, win pull-back) are expressed in the same
 * front-based frame.
 */

import * as THREE from 'three';

export interface CameraPose {
  azimuth: number;
  elevation: number;
  distance: number;
  target: THREE.Vector3;
}

/**
 * A complete view the player can come back to. `manualZoom` is part of it
 * because it decides whether a later refit may overwrite the distance, so
 * dropping it would quietly change how the view behaves next time.
 */
export interface CameraSnapshot extends CameraPose {
  manualZoom: boolean;
}

/** Azimuth that puts the camera straight in front of the board. */
export const FRONT_AZIMUTH = Math.PI / 2;
/** Small upward tilt: shows cube tops without skewing the grid. */
export const FRONT_ELEVATION = 0.16;
/** How far the player may orbit away from dead-front. */
const AZIMUTH_SWING = 0.42;

const MIN_DIST = 8;
const MAX_DIST = 60;
const MIN_ELEV = 0.04;
const MAX_ELEV = 0.62;

export class CameraController {
  azimuth = FRONT_AZIMUTH;
  elevation = FRONT_ELEVATION;
  distance = 26;
  target = new THREE.Vector3(0, 0, -0.55);

  private desired = { azimuth: this.azimuth, elevation: this.elevation, distance: this.distance };
  private fitDistance = 26;
  private cols = 10;
  private rows = 16;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  private pinchDistance = 0;
  private cinematic: {
    from: CameraPose;
    to: CameraPose;
    t: number;
    dur: number;
    onDone?: () => void;
  } | null = null;
  private shakeTime = 0;
  private shakeMag = 0;
  private disposed = false;
  /** True once the player has zoomed by hand; refits then leave distance alone. */
  private manualZoom = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly el: HTMLElement,
  ) {
    this.el.style.touchAction = 'none';
    this.el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.el.addEventListener('wheel', this.onWheel, { passive: false });
    this.el.addEventListener('contextmenu', this.onContext);
    this.fitToBoard();
    this.azimuth = FRONT_AZIMUTH;
    this.elevation = FRONT_ELEVATION;
    this.desired = { azimuth: this.azimuth, elevation: this.elevation, distance: this.fitDistance };
    this.distance = this.fitDistance;
    this.apply(0);
  }

  /** Frame the whole shaft with a little breathing room (front-on). */
  fitToBoard(cols = this.cols, rows = this.rows): void {
    this.cols = cols;
    this.rows = rows;
    const aspect = Math.max(0.4, this.el.clientWidth / Math.max(1, this.el.clientHeight));
    const az = FRONT_AZIMUTH;
    const el = FRONT_ELEVATION;
    // Vertical extent is asymmetric: the grid spans ±rows/2, while a freshly
    // spawned 2x2 hangs one row above row 0, reaching rows/2 + 1. Framing is
    // symmetric about the look-at point, so reserve that headroom plus margin.
    const halfW = (cols + 1.2) / 2;
    const halfH = (rows + 2.8) / 2;
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const vExtent = halfH * Math.abs(up.y) + halfW * Math.abs(up.x);
    const hExtent = halfW * Math.abs(right.x) + halfH * Math.abs(right.y);
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const distV = vExtent / tanV;
    const distH = hExtent / (tanV * aspect);
    this.fitDistance = clamp(Math.max(distV, distH) * 1.06, MIN_DIST, MAX_DIST);
  }

  private clampAzimuth(v: number): number {
    return clamp(v, FRONT_AZIMUTH - AZIMUTH_SWING, FRONT_AZIMUTH + AZIMUTH_SWING);
  }

  private onContext = (e: Event): void => e.preventDefault();

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.cinematic = null;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = this.distance;
      this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (this.disposed) return;
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDistance > 0) {
        const ratio = d / this.pinchDistance;
        this.desired.distance = clamp(this.pinchStart / ratio, MIN_DIST, MAX_DIST);
        this.manualZoom = true;
      }
      return;
    }
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Horizontal drag peeks at the side faces, but only within the front band.
    this.desired.azimuth = this.clampAzimuth(this.desired.azimuth - dx * 0.0032);
    this.desired.elevation = clamp(this.desired.elevation + dy * 0.0028, MIN_ELEV, MAX_ELEV);
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.pinchDistance = 0;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.cinematic = null;
    const factor = e.deltaY > 0 ? 1.08 : 0.925;
    this.desired.distance = clamp(this.desired.distance * factor, MIN_DIST, MAX_DIST);
    this.manualZoom = true;
  };

  zoomBy(factor: number): void {
    this.desired.distance = clamp(this.desired.distance * factor, MIN_DIST, MAX_DIST);
    this.manualZoom = true;
  }

  /**
   * Re-frame after a resize or a grid change. In a front view the board exactly
   * fills the viewport, so a stale fit would clip the outermost columns; the
   * player's own zoom is respected.
   */
  refit(): void {
    this.fitToBoard();
    if (!this.manualZoom) this.desired.distance = this.fitDistance;
  }

  /** Copy of the current view, safe to hand back to `restorePose` later. */
  capturePose(): CameraSnapshot {
    return {
      azimuth: this.azimuth,
      elevation: this.elevation,
      distance: this.distance,
      target: this.target.clone(),
      manualZoom: this.manualZoom,
    };
  }

  /**
   * Put the view back exactly where the player left it, synchronously.
   *
   * Used when the same board is played again (retry / restart): the win
   * cinematic leaves the camera pulled back, so the player's own orbit and
   * zoom are what they expect to see when the board comes back.
   */
  restorePose(pose: CameraSnapshot): void {
    this.cinematic = null;
    this.shakeTime = 0;
    this.manualZoom = pose.manualZoom;
    // Refresh the fit for the current viewport; it only wins when the player
    // never zoomed by hand.
    this.fitToBoard();
    this.azimuth = this.clampAzimuth(pose.azimuth);
    this.elevation = clamp(pose.elevation, MIN_ELEV, MAX_ELEV);
    this.distance = this.manualZoom ? clamp(pose.distance, MIN_DIST, MAX_DIST) : this.fitDistance;
    this.target.copy(pose.target);
    this.desired = { azimuth: this.azimuth, elevation: this.elevation, distance: this.distance };
    this.apply(0);
  }

  /**
   * Drop any in-flight cinematic (pull-back, fly-in) but leave the view where
   * it currently is: an in-run restart must not move the camera at all.
   */
  keepView(): void {
    this.cinematic = null;
    this.shakeTime = 0;
    this.desired = { azimuth: this.azimuth, elevation: this.elevation, distance: this.distance };
  }

  /**
   * Hard reset for a brand-new board (level change, next tutorial step).
   *
   * Not the same as `refit()`: here the previous screen's state is meaningless,
   * so a cinematic pull-back is cancelled and the player's manual zoom is
   * forgotten. The camera snaps — synchronously, with no easing and no timers —
   * back to the default front framing, which is why every tutorial step opens at
   * exactly the same size as step 1.
   */
  refitForNewScene(): void {
    this.cinematic = null;
    this.manualZoom = false;
    this.shakeTime = 0;
    this.fitToBoard();
    this.azimuth = FRONT_AZIMUTH;
    this.elevation = FRONT_ELEVATION;
    this.distance = this.fitDistance;
    this.desired = { azimuth: FRONT_AZIMUTH, elevation: FRONT_ELEVATION, distance: this.fitDistance };
    this.target.set(0, 0, -0.55);
    this.apply(0);
  }

  /** Nudge the view sideways / up, always snapped back inside the front band. */
  rotateBy(delta: number): void {
    this.desired.azimuth = this.clampAzimuth(this.desired.azimuth + delta);
  }

  /** Snap back to a dead-centre front view. */
  reset(): void {
    this.desired.azimuth = FRONT_AZIMUTH;
    this.desired.elevation = FRONT_ELEVATION;
    this.desired.distance = this.fitDistance;
    this.manualZoom = false;
    this.target.set(0, 0, -0.55);
  }

  shake(mag = 0.35, dur = 0.4): void {
    this.shakeMag = mag;
    this.shakeTime = dur;
  }

  /** Cinematic pull-back used when the level is cleared. */
  pullBack(duration = 3.2, onDone?: () => void): void {
    const from: CameraPose = {
      azimuth: this.azimuth,
      elevation: this.elevation,
      distance: this.distance,
      target: this.target.clone(),
    };
    const to: CameraPose = {
      azimuth: this.clampAzimuth(FRONT_AZIMUTH - 0.16),
      elevation: clamp(this.elevation + 0.12, MIN_ELEV, MAX_ELEV),
      distance: clamp(this.fitDistance * 1.42 + 3, MIN_DIST, MAX_DIST),
      target: this.target.clone(),
    };
    this.cinematic = { from, to, t: 0, dur: duration, onDone };
  }

  /** Fast but gentle fly-in when entering a level: tilt up into the front view. */
  flyIn(): void {
    this.fitToBoard();
    this.manualZoom = false;
    const from: CameraPose = {
      azimuth: FRONT_AZIMUTH + 0.22,
      elevation: MIN_ELEV,
      distance: this.fitDistance * 1.22,
      target: this.target.clone(),
    };
    const to: CameraPose = {
      azimuth: FRONT_AZIMUTH,
      elevation: FRONT_ELEVATION,
      distance: this.fitDistance,
      target: this.target.clone(),
    };
    this.azimuth = from.azimuth;
    this.elevation = from.elevation;
    this.distance = from.distance;
    this.desired = { azimuth: to.azimuth, elevation: to.elevation, distance: to.distance };
    this.cinematic = { from, to, t: 0, dur: 1.1 };
  }

  update(dt: number): void {
    if (this.cinematic) {
      this.cinematic.t += dt;
      const raw = Math.min(1, this.cinematic.t / this.cinematic.dur);
      const k = easeInOut(raw);
      const { from, to } = this.cinematic;
      this.azimuth = lerp(from.azimuth, to.azimuth, k);
      this.elevation = lerp(from.elevation, to.elevation, k);
      this.distance = lerp(from.distance, to.distance, k);
      this.desired = {
        azimuth: this.azimuth,
        elevation: this.elevation,
        distance: this.distance,
      };
      if (raw >= 1) {
        const done = this.cinematic.onDone;
        this.cinematic = null;
        done?.();
      }
    } else {
      const k = 1 - Math.pow(0.001, dt);
      this.azimuth = lerp(this.azimuth, this.desired.azimuth, k);
      this.elevation = lerp(this.elevation, this.desired.elevation, k);
      this.distance = lerp(this.distance, this.desired.distance, k);
    }
    this.apply(dt);
  }

  private apply(dt: number): void {
    const cx = Math.cos(this.azimuth) * Math.cos(this.elevation) * this.distance;
    const cy = Math.sin(this.elevation) * this.distance;
    const cz = Math.sin(this.azimuth) * Math.cos(this.elevation) * this.distance;
    let sx = 0;
    let sy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const mag = this.shakeMag * (this.shakeTime > 0 ? 1 : 0);
      sx = Math.sin(performance.now() * 0.09) * mag;
      sy = Math.cos(performance.now() * 0.11) * mag;
    }
    this.camera.position.set(this.target.x + cx + sx, this.target.y + cy + sy, this.target.z + cz);
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
  }

  dispose(): void {
    this.disposed = true;
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContext);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
