/**
 * Water VFX: drain streams, splash on impact and overflow spray.
 *
 * The voxel water bodies themselves are instanced in VoxelRenderer (one draw
 * call, height-encoded). This module owns the moving water: droplets falling
 * into drains, the burst when a pocket breaks, and the spray when a column
 * overflows. All particles are drawn with a single InstancedMesh.
 */

import * as THREE from 'three';

export interface WaterBurstRequest {
  x: number;
  y: number;
  count?: number;
  dirty?: boolean;
  kind?: 'splash' | 'drain' | 'overflow' | 'burst';
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  dirty: boolean;
  size: number;
}

export class WaterRenderer {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private particles: Particle[] = [];
  private cols = 10;
  private rows = 16;
  private capacity = 900;

  constructor() {
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, mat, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.group.add(this.mesh);
  }

  setGrid(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  private world(x: number, y: number): { px: number; py: number } {
    return {
      px: x - (this.cols - 1) / 2,
      py: (this.rows - 1) / 2 - y,
    };
  }

  emit(req: WaterBurstRequest): void {
    const count = req.count ?? 14;
    const { px, py } = this.world(req.x, req.y);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.capacity) break;
      const a = this.rand(req.x * 31 + i, req.y * 17 + i);
      const b = this.rand(req.y * 13 + i * 7, req.x * 29 + i);
      const kind = req.kind ?? 'splash';
      let vx = (a - 0.5) * 2.4;
      let vy = b * 2.6 + 0.4;
      if (kind === 'drain') {
        vx = (a - 0.5) * 0.5;
        vy = 1.4 + b * 1.6;
      } else if (kind === 'overflow') {
        vx = (a - 0.5) * 1.2;
        vy = -0.2 - b * 1.4;
      } else if (kind === 'burst') {
        vx = (a - 0.5) * 3.4;
        vy = (b - 0.2) * 3.2;
      }
      this.particles.push({
        x: px + (a - 0.5) * 0.5,
        y: py + (b - 0.5) * 0.35,
        vx,
        vy,
        life: 0,
        maxLife: 0.45 + b * 0.5,
        dirty: req.dirty ?? false,
        size: 0.55 + a * 0.9,
      });
    }
  }

  update(dt: number): void {
    let count = 0;
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      p.vy -= 5.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alive.push(p);
      if (count >= this.capacity) continue;
      const t = p.life / p.maxLife;
      const scale = p.size * (1 - t * 0.6);
      // Front view: particles must sit in front of the voxel slabs (which reach
      // z = 0.45) or the depth test would hide them inside the cube.
      this.dummy.position.set(p.x, p.y, 0.62 + Math.sin(p.life * 9) * 0.05);
      this.dummy.scale.set(scale, scale, scale);
      this.dummy.rotation.set(p.life * 3, p.life * 2, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);
      if (p.dirty) this.color.setHex(0x7d8a3a);
      else this.color.setHex(0x5fd6ff);
      this.color.offsetHSL(0, 0, 0.08 * (1 - t));
      this.mesh.setColorAt(count, this.color);
      count++;
    }
    this.particles = alive;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get particleCount(): number {
    return this.particles.length;
  }

  clear(): void {
    this.particles = [];
    this.mesh.count = 0;
  }

  private rand(a: number, b: number): number {
    let h = Math.imul(Math.floor(a * 1000) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
    h ^= Math.imul(Math.floor(b * 1000) + 0x27d4eb2f, 0x165667b1) >>> 0;
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.group.clear();
  }
}
