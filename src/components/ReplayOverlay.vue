<script setup lang="ts">
/**
 * ReplayOverlay — re-simulates a share code in its own Three.js viewport.
 *
 * Playback is deterministic: the stored operation stream is replayed tick by
 * tick through a fresh GameEngine with the same seed. Play/pause, speed, scrub
 * and a per-goal summary are available.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import type { GameEngine } from '@/game/core/engine';
import { ReplayDriver, resolveLevel } from '@/game/core/replay';
import { SceneManager } from '@/game/three/SceneManager';
import { VoxelRenderer, type VoxelFrame } from '@/game/three/VoxelRenderer';
import { WaterRenderer } from '@/game/three/WaterRenderer';
import { CameraController } from '@/game/three/CameraController';
import { DropTrails } from '@/game/three/DropTrails';

const store = useGameStore();
const session = computed(() => store.replaySession);

const canvas = ref<HTMLCanvasElement | null>(null);
const playing = ref(true);
const speed = ref(2);
const tickNow = ref(0);
const totalTicks = ref(0);
const finished = ref(false);
const error = ref('');

const scene = shallowRef<SceneManager | null>(null);
const voxels = shallowRef<VoxelRenderer | null>(null);
const waterFx = shallowRef<WaterRenderer | null>(null);
const cam = shallowRef<CameraController | null>(null);
let driver: ReplayDriver | null = null;
/** Slam animations for hard drops, so space-presses read as a slam. */
const dropTrails = new DropTrails();
const dropCursor = { value: 0 };
let engine: GameEngine | null = null;
let raf = 0;
let last = 0;
let acc = 0;

const TICK = 1 / 60;

const progressPct = computed(() =>
  totalTicks.value > 0 ? Math.min(100, (tickNow.value / totalTicks.value) * 100) : 0,
);
const statusLabel = computed(() => {
  if (error.value) return '回放失败';
  if (finished.value) return engine?.status === 'won' ? '回放结束 · 通关' : '回放结束';
  return playing.value ? '回放中' : '已暂停';
});

function initEngine(): void {
  const s = session.value;
  if (!s) return;
  const level = resolveLevel(s.payload);
  if (!level) {
    error.value = `未知关卡 ${s.payload.l}`;
    return;
  }
  try {
    // The player reproduces the recorded drops; the engine decides when the run
    // ends. Its terminal check is the very same one a real run uses.
    driver = new ReplayDriver(s.payload, level);
  } catch (e) {
    error.value = (e as Error).message;
    return;
  }
  engine = driver.engine;
  // The recorded totalTicks is the tick the engine ended the run on, so using it
  // as the scrub length makes the bar land on 100% exactly when playback stops.
  // Older codes may lack it; fall back to the last lock tick plus a short settle.
  const pl = s.payload.pl ?? [];
  const lastLock = pl.length ? pl[pl.length - 1].t : 0;
  totalTicks.value = Math.max(1, s.payload.tt ?? lastLock + 120);
  tickNow.value = 0;
  finished.value = false;
  playing.value = true;
  buildScene();
}

function buildScene(): void {
  const el = canvas.value;
  if (!el || !engine) return;
  try {
    const sm = new SceneManager({ canvas: el, cols: engine.cols, rows: engine.rows });
    const vr = new VoxelRenderer();
    const wr = new WaterRenderer();
    const cc = new CameraController(sm.camera, el);
    sm.root.add(vr.group);
    sm.root.add(wr.group);
    vr.setGrid(engine.cols, engine.rows);
    wr.setGrid(engine.cols, engine.rows);
    sm.setGridSize(engine.cols, engine.rows);
    scene.value = sm;
    voxels.value = vr;
    waterFx.value = wr;
    cam.value = cc;
    cc.flyIn();
    last = 0;
    acc = 0;
    raf = requestAnimationFrame(frame);
  } catch (e) {
    error.value = `3D 回放初始化失败：${(e as Error).message}`;
  }
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  if (!engine) return;
  if (!last) last = now;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (playing.value && !finished.value) {
    acc += dt * speed.value;
    let guard = 0;
    while (acc >= TICK && guard < 40) {
      acc -= TICK;
      guard++;
      if (!driver || driver.finished) break;
      driver.tick();
      if (driver.finished) {
        finished.value = true;
        break;
      }
    }
    // Once the engine has ended the run, the bar sits at 100% and stops: the
    // recorded totalTicks is exactly the tick the engine stopped on.
    tickNow.value = finished.value ? totalTicks.value : (engine?.tick ?? 0);
  }

  const snap = engine.view();
  const vr = voxels.value;
  const wr = waterFx.value;
  const sm = scene.value;
  const cc = cam.value;
  if (vr && wr && sm) {
    dropTrails.sync(engine.hardDrops, dropCursor);
    dropTrails.update(dt);
    const f: VoxelFrame = {
      cols: snap.cols,
      rows: snap.rows,
      grid: snap.grid,
      clean: snap.clean,
      dirty: snap.dirty,
      pressure: snap.pressure,
      meta: snap.meta,
      piece: snap.piece,
      ghostY: snap.ghostY,
      previewClean: null,
      previewDirty: null,
      showPreview: false,
      dangerCols: snap.dangerCols,
      time: performance.now() / 1000,
      dropTrails: dropTrails.frame(),
    };
    vr.update(f);
    wr.update(dt);
    sm.setOverflowAlert(Math.max(0, 1 - snap.waterline / Math.max(1, snap.rows * 0.5)));
  }
  cc?.update(dt);
  sm?.render();
}

function togglePlay(): void {
  if (finished.value) {
    restartPlayback();
    return;
  }
  playing.value = !playing.value;
}

function restartPlayback(): void {
  disposeScene();
  initEngine();
}

function disposeScene(): void {
  cancelAnimationFrame(raf);
  cam.value?.dispose();
  voxels.value?.dispose();
  waterFx.value?.dispose();
  scene.value?.dispose();
  scene.value = null;
  voxels.value = null;
  waterFx.value = null;
  cam.value = null;
  driver = null;
  engine = null;
  dropTrails.reset();
  dropCursor.value = 0;
}

function close(): void {
  disposeScene();
  store.closeReplay();
}

function setSpeed(s: number): void {
  speed.value = s;
}

onMounted(() => initEngine());
onBeforeUnmount(() => disposeScene());

watch(
  () => session.value,
  () => {
    disposeScene();
    initEngine();
  },
);
</script>

<template>
  <div class="replay">
    <div class="viewport">
      <canvas ref="canvas"></canvas>
      <div class="topbar">
        <button class="back" @click="close">← 退出回放</button>
        <div class="meta">
          <span class="badge">回放</span>
          <span>{{ session?.levelName ?? '未知关卡' }}</span>
          <span class="seed">种子 {{ session?.payload.s }}</span>
        </div>
        <div class="status" :class="{ done: finished }">{{ statusLabel }}</div>
      </div>
      <div v-if="error" class="err">{{ error }}</div>
    </div>

    <footer class="controls">
      <button class="play" @click="togglePlay">{{ finished ? '↻ 重新回放' : playing ? '⏸ 暂停' : '▶ 继续' }}</button>
      <div class="scrub">
        <div class="bar"><i :style="{ width: progressPct + '%' }"></i></div>
        <span>{{ (tickNow / 60).toFixed(1) }}s / {{ (totalTicks / 60).toFixed(1) }}s</span>
      </div>
      <div class="speeds">
        <button v-for="s in [1, 2, 4]" :key="s" :class="{ on: speed === s }" @click="setSpeed(s)">{{ s }}×</button>
      </div>
      <button class="ghost" @click="restartPlayback">重头播放</button>
    </footer>
  </div>
</template>

<style scoped>
.replay {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-rows: 1fr auto;
  background: #070b10;
  z-index: 60;
}
.viewport {
  position: relative;
  min-height: 0;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.7rem 0.9rem;
  background: linear-gradient(180deg, rgba(8, 13, 18, 0.9), transparent);
  pointer-events: none;
}
.back,
.controls button {
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(120, 190, 230, 0.2);
  color: #cfe4f2;
  border-radius: 9px;
  padding: 0.4rem 0.7rem;
  font-size: 0.76rem;
  cursor: pointer;
}
.back:hover,
.controls button:hover {
  border-color: rgba(127, 233, 255, 0.5);
}
.meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #c6d8e5;
  font-size: 0.8rem;
}
.badge {
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
  background: rgba(127, 233, 255, 0.14);
  border: 1px solid rgba(127, 233, 255, 0.34);
  color: #9be8ff;
}
.seed {
  color: #6d8394;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.68rem;
}
.status {
  margin-left: auto;
  color: #9be8ff;
  font-size: 0.74rem;
}
.status.done {
  color: #8ef0b6;
}
.err {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #ffb0b0;
  background: rgba(9, 14, 20, 0.9);
}
.controls {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.65rem 0.9rem;
  background: #0b131b;
  border-top: 1px solid rgba(120, 190, 230, 0.14);
}
.play {
  border-color: rgba(127, 233, 255, 0.4) !important;
  color: #9be8ff !important;
  min-width: 96px;
}
.scrub {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.bar {
  height: 0.35rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #2a9dc4, #7fe9ff);
  transition: width 0.1s linear;
}
.scrub span {
  font-size: 0.62rem;
  color: #6d8394;
  font-variant-numeric: tabular-nums;
}
.speeds {
  display: flex;
  gap: 0.2rem;
}
.speeds button.on {
  background: rgba(127, 233, 255, 0.16);
  border-color: rgba(127, 233, 255, 0.45);
  color: #9be8ff;
}
.ghost {
  background: transparent !important;
}
</style>
