/**
 * Scene bootstrap: renderer, camera, lights, board, grid and overflow line.
 * Vue never touches Three objects directly; SceneManager owns them.
 */

import * as THREE from 'three';
import { MATERIAL_COLORS } from '../core/constants';

export interface SceneOptions {
  cols: number;
  rows: number;
  canvas: HTMLCanvasElement;
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly root = new THREE.Group();
  readonly boardGroup = new THREE.Group();

  cols: number;
  rows: number;
  private overflowLine: THREE.Mesh | null = null;
  private raf = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(opts: SceneOptions) {
    this.cols = opts.cols;
    this.rows = opts.rows;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene.background = new THREE.Color(0x0b1118);
    this.scene.fog = new THREE.Fog(0x0b1118, 70, 150);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.camera.position.set(11, 9, 21);
    this.camera.lookAt(0, 0, 0);

    this.root.add(this.boardGroup);
    this.scene.add(this.root);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x2a3644, 1.45);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(0x8fb6d0, 0.5));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.1);
    key.position.set(8, 14, 12);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x55b9ff, 0.85);
    rim.position.set(-10, 5, -8);
    this.scene.add(rim);

    this.buildBoard();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(opts.canvas.parentElement ?? opts.canvas);
    }
    window.addEventListener('resize', this.resize);
  }

  /** World position for a grid cell (cell centre). */
  cellToWorld(x: number, y: number, z = 0): THREE.Vector3 {
    return new THREE.Vector3(x - (this.cols - 1) / 2, (this.rows - 1) / 2 - y, z);
  }

  private buildBoard(): void {
    while (this.boardGroup.children.length) {
      const child = this.boardGroup.children.pop() as THREE.Object3D;
      this.boardGroup.remove(child);
    }

    const w = this.cols + 0.7;
    const h = this.rows + 0.7;

    // Front-facing layout: voxels occupy z in [-0.5, 0.5], so the backing plate
    // sits just behind them (never overlapping) and the bezel behind that. In a
    // front view any depth overlap would z-fight, so the offsets are explicit.
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x16222e, roughness: 0.92, metalness: 0.05 }),
    );
    base.position.set(0, 0, -0.82);
    this.boardGroup.add(base);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.34, h + 0.34, 0.22),
      new THREE.MeshStandardMaterial({
        color: 0x27435c,
        roughness: 0.5,
        metalness: 0.35,
        emissive: 0x0b1e2c,
        emissiveIntensity: 0.9,
      }),
    );
    frame.position.set(0, 0, -1.18);
    this.boardGroup.add(frame);

    // Grid lines sit on the plate's front face: visible through the gaps
    // between voxels, giving each cell a readable outline in the front view.
    const lineMat = new THREE.LineBasicMaterial({ color: 0x2d4a63, transparent: true, opacity: 0.55 });
    const gridZ = -0.52;
    const pts: number[] = [];
    for (let x = 0; x <= this.cols; x++) {
      const wx = x - this.cols / 2;
      pts.push(wx, -this.rows / 2, gridZ, wx, this.rows / 2, gridZ);
    }
    for (let y = 0; y <= this.rows; y++) {
      const wy = y - this.rows / 2;
      pts.push(-this.cols / 2, wy, gridZ, this.cols / 2, wy, gridZ);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, lineMat);
    this.boardGroup.add(lines);

    // Glowing overflow line above row 0.
    const lineY = this.rows / 2 + 0.18;
    const overflow = new THREE.Mesh(
      new THREE.BoxGeometry(this.cols + 0.2, 0.09, 0.09),
      new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.9 }),
    );
    overflow.position.set(0, lineY, 0.05);
    this.boardGroup.add(overflow);
    this.overflowLine = overflow;

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.cols + 0.2, 1.1),
      new THREE.MeshBasicMaterial({
        color: 0xff5a5a,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.set(0, lineY - 0.5, 0.02);
    this.boardGroup.add(glow);

    // Drain sockets are drawn by the voxel renderer; add a soft under-glow here.
    const drainGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.cols + 0.6, 1.1),
      new THREE.MeshBasicMaterial({
        color: 0x2ba9c8,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    drainGlow.position.set(0, -this.rows / 2 - 0.05, 0.06);
    this.boardGroup.add(drainGlow);
  }

  setGridSize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.buildBoard();
    this.camera.aspect = this.aspect();
    this.camera.updateProjectionMatrix();
  }

  private aspect(): number {
    const canvas = this.renderer.domElement;
    return Math.max(0.35, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  }

  resize = (): void => {
    if (this.disposed) return;
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || canvas.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = Math.max(0.35, w / Math.max(1, h));
    this.camera.updateProjectionMatrix();
  };

  setOverflowAlert(level: number): void {
    if (!this.overflowLine) return;
    const mat = this.overflowLine.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.35 + Math.min(1, level) * 0.65;
    mat.color.setHex(level > 0.5 ? 0xff3b3b : 0xff8a5a);
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  start(onFrame: () => void): void {
    const loop = (): void => {
      if (this.disposed) return;
      onFrame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.resizeObserver?.disconnect();
    this.scene.traverse((obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}

export function materialColor(m: number): number {
  return MATERIAL_COLORS[m] ?? 0x8899aa;
}
