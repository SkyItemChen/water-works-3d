/**
 * WowMoments — orchestrates the three signature visual beats.
 *
 * 1. MIX      clean + dirty water merge -> colour transition pulse + slow zoom
 * 2. BURST    sand / pipe pressure failure -> debris + shockwave + camera shake
 * 3. DRAIN    level cleared -> water empties, basin reveals, camera pulls back
 *
 * The module is decoupled from the simulation: it only reacts to events the
 * store forwards, so it never affects determinism.
 */

import type { Effects } from './Effects';
import type { WaterRenderer } from './WaterRenderer';
import type { CameraController } from './CameraController';
import type { SceneManager } from './SceneManager';
import type { SimEvent } from '../core/types';

export type WowKind = 'mix' | 'burst' | 'drain';

export interface WowStatus {
  last: WowKind | null;
  mixAt: number;
  burstAt: number;
  drainAt: number;
  active: boolean;
  drainedFraction: number;
}

export class WowMoments {
  private mixCooldown = 0;
  private mixSeen = new Set<number>();
  status: WowStatus = {
    last: null,
    mixAt: 0,
    burstAt: 0,
    drainAt: 0,
    active: false,
    drainedFraction: 0,
  };
  private drainStart = 0;
  private drainFrom = 0;
  private drainGoal = 0;

  constructor(
    private readonly effects: Effects,
    private readonly water: WaterRenderer,
    private readonly camera: CameraController,
    private readonly scene: SceneManager,
  ) {}

  /** Feed the simulation event list once per fixed step. */
  consume(events: SimEvent[], cols: number): void {
    for (const ev of events) {
      if (ev.type === 'mix') {
        if (this.mixCooldown > 0) continue;
        this.mixCooldown = 1.4;
        if (this.mixSeen.size < 200) this.mixSeen.add(ev.cell);
        this.status.last = 'mix';
        this.status.mixAt = performance.now();
        this.water.emit({ x: ev.x, y: ev.y, count: 6, dirty: false, kind: 'splash' });
      } else if (ev.type === 'sandCollapse' || ev.type === 'pipeBurst') {
        this.status.last = 'burst';
        this.status.burstAt = performance.now();
        this.effects.burst({
          type: ev.type === 'sandCollapse' ? 'sandCollapse' : 'pipeBurst',
          x: ev.x,
          y: ev.y,
        });
        this.camera.shake(0.45, 0.45);
      } else if (ev.type === 'soilCrack') {
        this.effects.burst({ type: 'soilCrack', x: ev.x, y: ev.y });
        this.camera.shake(0.18, 0.25);
      } else if (ev.type === 'overflow') {
        this.water.emit({ x: ev.x, y: 0, count: 3, kind: 'overflow', dirty: false });
        this.scene.setOverflowAlert(Math.min(1, ev.amount * 40));
      } else if (ev.type === 'drain') {
        this.water.emit({ x: ev.x, y: ev.y, count: 4, dirty: (ev.dirty ?? 0) > (ev.clean ?? 0), kind: 'drain' });
      }
    }
    void cols;
  }

  /**
   * Called once when the level is won.
   *
   * `withCamera` is a presentation switch: tutorial steps are each a complete
   * level, so an intermediate step must empty the basin *without* yanking the
   * camera away — the next step has to look exactly like the previous one.
   * The flag never reaches the simulation or the state hash.
   */
  triggerDrain(totalWater: number, duration = 4.2, withCamera = true): void {
    this.status.last = 'drain';
    this.status.drainAt = performance.now();
    this.status.active = true;
    this.drainStart = performance.now() / 1000;
    this.drainFrom = totalWater;
    this.drainGoal = duration;
    this.effects.winBurst(10, 16);
    if (withCamera) this.camera.pullBack(duration);
  }

  update(dt: number): void {
    if (this.mixCooldown > 0) this.mixCooldown -= dt;
    this.status.mixAt = this.mixCooldown > 0 ? this.status.mixAt : 0;
    if (this.status.active) {
      const elapsed = performance.now() / 1000 - this.drainStart;
      this.status.drainedFraction = Math.min(1, elapsed / Math.max(0.1, this.drainGoal));
      if (elapsed > this.drainGoal) {
        this.status.active = false;
      }
    }
  }

  reset(): void {
    this.mixSeen.clear();
    this.mixCooldown = 0;
    this.status = {
      last: null,
      mixAt: 0,
      burstAt: 0,
      drainAt: 0,
      active: false,
      drainedFraction: 0,
    };
  }
}
