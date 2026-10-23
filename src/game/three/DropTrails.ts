/**
 * DropTrails — turns instantaneous hard drops into a visible slam.
 *
 * A hard drop is one tick in the rules: the piece leaves its row, lands and
 * locks. Drawing that tick faithfully looks like a teleport, so this keeps the
 * last few drops around for a fraction of a second and reports each one's
 * progress; `VoxelRenderer` draws the fading echoes.
 *
 * Pure presentation: it reads `engine.hardDrops` (a render-only log) and never
 * writes back to the engine, the store or the state hash.
 */

import type { HardDropFx } from '../core/types';

export interface DropTrailFrame {
  fromY: number;
  toY: number;
  x: number;
  cells: { x: number; y: number }[];
  color: string;
  /** 0 at the moment of the drop, 1 when it has faded out. */
  age: number;
}

/** How long a slam stays on screen, in seconds. Fast enough to feel like a slam. */
const TRAIL_SECONDS = 0.18;

export class DropTrails {
  private readonly live: { fx: HardDropFx; age: number }[] = [];

  /**
   * Pull any drops the engine recorded since the last call. `cursor` is the
   * caller's bookmark into `engine.hardDrops`, which the engine trims once it
   * exceeds its cap — so an out-of-range cursor restarts from the newest entry.
   */
  sync(drops: HardDropFx[], cursor: { value: number }): void {
    if (cursor.value > drops.length) cursor.value = drops.length;
    for (let i = cursor.value; i < drops.length; i++) {
      // Skip anything already older than its lifetime (a paused tab, a slow
      // frame): replaying a stale slam would read as a flicker.
      this.live.push({ fx: drops[i], age: 0 });
    }
    cursor.value = drops.length;
    const cap = 8;
    if (this.live.length > cap) this.live.splice(0, this.live.length - cap);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      this.live[i].age += dt / TRAIL_SECONDS;
      if (this.live[i].age >= 1) this.live.splice(i, 1);
    }
  }

  /** Trails to draw this frame, newest first. */
  frame(): DropTrailFrame[] {
    return this.live.map((l) => ({
      fromY: l.fx.fromY,
      toY: l.fx.toY,
      x: l.fx.x,
      cells: l.fx.cells,
      color: l.fx.color,
      age: l.age,
    }));
  }

  reset(): void {
    this.live.length = 0;
  }
}
