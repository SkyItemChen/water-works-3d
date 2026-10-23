/**
 * Particle / light effects: drain sparkles, sand debris, pressure shockwave and
 * the final "empty basin" sweep.
 *
 * Everything uses InstancedMesh + additive sprites so it stays at 60fps.
 */

import * as THREE from 'three';

export interface EffectEvent {
  type: 'drainClean' | 'drainDirty' | 'sandCollapse' | 'pipeBurst' | 'soilCrack' | 'overflow' | 'win';
  x: number;
  y: number;
  amount?: number;
}

interface Burst {
  origin: THREE.Vector3;
  color: THREE.Color;
  particles: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; size: number }[];
  kind: 'debris' | 'spray' | 'sparkle';
}

export class Effects {
  readonly group = new THREE.Group();
  private bursts: Burst[] = [];
  private mesh: THREE.InstancedMesh;
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private dummy = new THREE.Object3D();
  private cols = 10;
  private rows = 16;
  private ring: THREE.Mesh;
  private ringLife = 0;
  private winGlow: THREE.PointLight;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, mat, 1400);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.group.add(this.mesh);

    const ringGeo = new THREE.RingGeometry(0.5, 0.62, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb066,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.visible = false;
    this.group.add(this.ring);

    this.winGlow = new THREE.PointLight(0x7fe9ff, 0, 40, 2);
    this.group.add(this.winGlow);
  }

  setGrid(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  private world(x: number, y: number): THREE.Vector3 {
    // Front view: spawn in front of the voxel slabs (they reach z = 0.45), so
    // debris and sparks are drawn over the board instead of inside it.
    return new THREE.Vector3(x - (this.cols - 1) / 2, (this.rows - 1) / 2 - y, 0.62);
  }

  burst(ev: EffectEvent): void {
    const origin = this.world(ev.x, ev.y);
    const color = new THREE.Color(
      ev.type === 'drainDirty'
        ? 0x8a9a3a
        : ev.type === 'drainClean'
          ? 0x5fd6ff
          : ev.type === 'pipeBurst'
            ? 0xff7a45
            : ev.type === 'soilCrack'
              ? 0x9a6744
              : ev.type === 'overflow'
                ? 0xff5a5a
                : 0xd8bd83,
    );
    const kind: Burst['kind'] =
      ev.type === 'drainClean' || ev.type === 'drainDirty'
        ? 'spray'
        : ev.type === 'sandCollapse' || ev.type === 'pipeBurst'
          ? 'debris'
          : 'sparkle';
    const count = kind === 'debris' ? 22 : kind === 'spray' ? 10 : 14;
    const particles: Burst['particles'] = [];
    for (let i = 0; i < count; i++) {
      const a = pseudo(ev.x * 91 + i, ev.y * 57 + i);
      const b = pseudo(ev.y * 33 + i * 3, ev.x * 77 + i);
      const vel = new THREE.Vector3(
        (a - 0.5) * (kind === 'debris' ? 4.2 : 2.4),
        (kind === 'debris' ? b * 3.4 : b * 2.6) + 0.6,
        (b - 0.5) * 0.6,
      );
      particles.push({
        pos: origin.clone().add(new THREE.Vector3((a - 0.5) * 0.5, (b - 0.5) * 0.4, 0)),
        vel,
        life: 0,
        max: 0.4 + b * 0.55,
        size: kind === 'debris' ? 0.1 + a * 0.14 : 0.09 + a * 0.12,
      });
    }
    this.bursts.push({ origin, color, particles, kind });
    if (this.bursts.length > 26) this.bursts.shift();

    if (ev.type === 'pipeBurst' || ev.type === 'soilCrack') {
      this.ring.position.copy(origin);
      this.ring.scale.setScalar(0.4);
      (this.ring.material as THREE.MeshBasicMaterial).color.setHex(
        ev.type === 'pipeBurst' ? 0xff7a45 : 0xffb066,
      );
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.9;
      this.ring.visible = true;
      this.ringLife = 0.55;
    }
  }

  /** Big celebratory burst for the clear "drain out" moment. */
  winBurst(cols: number, rows: number): void {
    for (let x = 0; x < cols; x += 2) {
      this.burst({ type: 'drainClean', x, y: rows - 1, amount: 1 });
    }
    this.winGlow.position.set(0, 0, 6);
    this.winGlow.intensity = 8;
  }

  update(dt: number): void {
    let count = 0;
    const alive: Burst[] = [];
    for (const b of this.bursts) {
      let live = 0;
      for (const p of b.particles) {
        p.life += dt;
        if (p.life >= p.max) continue;
        live++;
        if (count >= 1400) continue;
        p.vel.y -= 7.5 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const k = 1 - p.life / p.max;
        this.dummy.position.copy(p.pos);
        const s = p.size * (0.4 + k * 0.8);
        this.dummy.scale.set(s, s, s);
        this.dummy.rotation.set(p.life * 5, p.life * 4, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(count, this.dummy.matrix);
        this.mesh.setColorAt(count, b.color);
        count++;
      }
      if (live > 0) alive.push(b);
    }
    this.bursts = alive;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    if (this.ringLife > 0) {
      this.ringLife -= dt;
      const mat = this.ring.material as THREE.MeshBasicMaterial;
      this.ring.scale.addScalar(dt * 9);
      mat.opacity = Math.max(0, this.ringLife / 0.55) * 0.9;
      this.ring.visible = this.ringLife > 0;
    }
    if (this.winGlow.intensity > 0) {
      this.winGlow.intensity = Math.max(0, this.winGlow.intensity - dt * 6);
    }
  }

  clear(): void {
    this.bursts = [];
    this.mesh.count = 0;
    this.ring.visible = false;
    this.ringLife = 0;
    this.winGlow.intensity = 0;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.ring.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    this.group.clear();
  }
}

function pseudo(a: number, b: number): number {
  let h = Math.imul(Math.floor(a * 131) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= Math.imul(Math.floor(b * 197) + 0x27d4eb2f, 0x165667b1) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
