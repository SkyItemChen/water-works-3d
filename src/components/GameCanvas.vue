<script setup lang="ts">
/**
 * GameCanvas — owns the Three.js scene and the fixed-step loop.
 *
 * The store never holds Three objects. Everything here is markRaw/shallowRef so
 * Vue's reactivity never walks InstancedMesh matrices or typed arrays.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { SceneManager } from '@/game/three/SceneManager';
import { VoxelRenderer, type VoxelFrame } from '@/game/three/VoxelRenderer';
import { WaterRenderer } from '@/game/three/WaterRenderer';
import { Effects } from '@/game/three/Effects';
import { CameraController, type CameraSnapshot } from '@/game/three/CameraController';
import { WowMoments } from '@/game/three/WowMoments';
import { DropTrails } from '@/game/three/DropTrails';
import { useGameLoop } from '@/game/composables/useGameLoop';
import { useInput } from '@/game/composables/useInput';
import { useProgressStore } from '@/stores/progressStore';
import { todayKey } from '@/game/core/daily';
import { recordActionFor } from '@/game/core/presentation';

const props = defineProps<{ active: boolean }>();
const store = useGameStore();
const settings = useSettingsStore();
const progress = useProgressStore();

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const error = ref('');

const scene = shallowRef<SceneManager | null>(null);
const voxels = shallowRef<VoxelRenderer | null>(null);
const waterFx = shallowRef<WaterRenderer | null>(null);
const effects = shallowRef<Effects | null>(null);
const cameraCtl = shallowRef<CameraController | null>(null);
const wow = shallowRef<WowMoments | null>(null);
/** Slam animations for hard drops (presentation only). */
const dropTrails = new DropTrails();
/** Bookmark into `engine.hardDrops`, which the engine caps and trims. */
const dropCursor = { value: 0 };
let loop: ReturnType<typeof useGameLoop> | null = null;

/** 0..1 visual drain progress after a win. */
const drainFactor = ref(1);
let recordedRun = false;
/**
 * The view the player actually had when the run ended, captured before the win
 * cinematic pulls back. Retrying the same board restores it, so the player gets
 * their own orbit and zoom back instead of being reset to the default framing.
 */
let poseBeforeWin: CameraSnapshot | null = null;
/** Level id of the board on screen, used to tell a retry from a new board. */
let currentLevelId = '';

const hud = computed(() => store.snapshot);
const cols = computed(() => hud.value?.cols ?? 10);
const rows = computed(() => hud.value?.rows ?? 16);

function buildScene(): void {
  const el = canvas.value;
  if (!el) return;
  try {
    const sm = new SceneManager({ canvas: el, cols: cols.value, rows: rows.value });
    const vr = new VoxelRenderer();
    const wr = new WaterRenderer();
    const fx = new Effects();
    const cam = new CameraController(sm.camera, el);
    const wm = new WowMoments(fx, wr, cam, sm);
    sm.root.add(vr.group);
    sm.root.add(wr.group);
    sm.root.add(fx.group);
    sm.setGridSize(cols.value, rows.value);
    vr.setGrid(cols.value, rows.value);
    wr.setGrid(cols.value, rows.value);
    fx.setGrid(cols.value, rows.value);
    scene.value = markRawShallow(sm);
    voxels.value = markRawShallow(vr);
    waterFx.value = markRawShallow(wr);
    effects.value = markRawShallow(fx);
    cameraCtl.value = markRawShallow(cam);
    wow.value = markRawShallow(wm);

    loop = useGameLoop({
      onTick: () => {
        if (!store.paused) store.stepOnce();
      },
      onRender: (dt) => renderFrame(dt),
    });
    // Seed the board identity with the level this canvas was built for, so the
    // very first retry is already recognised as "same board" instead of a
    // fresh scene.
    currentLevelId = store.level?.id ?? '';
    loop.start();
    cam.flyIn();
  } catch (e) {
    error.value = `3D 初始化失败：${(e as Error).message}`;
    // Still allow the HUD/UI to work.
  }
}

function markRawShallow<T extends object>(obj: T): T {
  // Keep Three.js objects out of Vue's proxy machinery.
  return obj as T;
}

function renderFrame(dt: number): void {
  const sm = scene.value;
  const vr = voxels.value;
  const wr = waterFx.value;
  const fx = effects.value;
  const cam = cameraCtl.value;
  const wm = wow.value;
  const snap = store.snapshot;
  if (!sm || !vr || !wr || !fx || !cam || !wm || !snap) {
    sm?.render();
    return;
  }

  const e = store.engine;
  const status = e?.status ?? 'playing';

  // Visual drain: when the run is won, the basin empties over a few seconds.
  if (store.draining) {
    drainFactor.value = Math.max(0, drainFactor.value - dt / 2.8);
  } else if (status === 'playing') {
    drainFactor.value = 1;
  }
  const df = drainFactor.value;

  const showPreview = settings.showPreview && store.previewEnabled && status === 'playing';
  const prev = store.preview;

  let clean = snap.clean;
  let dirty = snap.dirty;
  if (df < 0.999) {
    clean = new Float64Array(snap.clean.length);
    dirty = new Float64Array(snap.dirty.length);
    for (let i = 0; i < snap.clean.length; i++) {
      clean[i] = snap.clean[i] * df;
      dirty[i] = snap.dirty[i] * df;
    }
  }

  const frame: VoxelFrame = {
    cols: snap.cols,
    rows: snap.rows,
    grid: snap.grid,
    clean,
    dirty,
    pressure: snap.pressure,
    meta: snap.meta,
    piece: snap.piece,
    ghostY: snap.ghostY,
    previewClean: showPreview ? prev?.clean ?? null : null,
    previewDirty: showPreview ? prev?.dirty ?? null : null,
    showPreview,
    dangerCols: snap.dangerCols,
    time: performance.now() / 1000,
    mixCells: snap.mixCells,
  };
  // Hard drops are one tick in the rules; pin the visual fall onto the same frame.
  dropTrails.sync(e?.hardDrops ?? [], dropCursor);
  dropTrails.update(dt);
  frame.dropTrails = dropTrails.frame();
  vr.update(frame);
  wr.update(dt);
  fx.update(dt);
  wm.update(dt);

  // Forward queued sim events to the wow/fx modules (once).
  const evs = store.consumeFx();
  if (evs.length) {
    wm.consume(evs, snap.cols);
    for (const ev of evs) {
      if (ev.type === 'sandCollapse' || ev.type === 'pipeBurst' || ev.type === 'soilCrack') {
        fx.burst({
          type: ev.type === 'sandCollapse' ? 'sandCollapse' : ev.type === 'pipeBurst' ? 'pipeBurst' : 'soilCrack',
          x: ev.x,
          y: ev.y,
        });
      }
    }
  }

  // Overflow line intensity tracks the waterline.
  const danger = Math.max(0, 1 - (snap.waterline ?? snap.rows) / Math.max(1, snap.rows * 0.45));
  sm.setOverflowAlert(danger);

  // Win: one-shot celebratory burst + basin drain. The camera only pulls back
  // when this run owns the contract finish — a coached tutorial step must leave
  // the framing untouched so the next step looks identical to this one.
  if (store.draining && !recordedRun) {
    const withCamera = !store.suppressWinPresentation;
    // Snapshot before `triggerDrain` starts the pull-back, so a retry can hand
    // the player back exactly the view they were using.
    poseBeforeWin = withCamera ? cam.capturePose() : null;
    wm.triggerDrain(e?.totalFieldWater() ?? 0, 3.0, withCamera);
    recordedRun = true;
  }

  cam.update(dt);
  sm.render();
}

const { setEnabled } = useInput({
  onAction: (a) => store.dispatch(a),
  onRestart: () => {
    if (store.screen === 'game') store.restart();
  },
  onPause: () => store.togglePause(),
  onToggleMute: () => settings.toggleMute(),
  onTogglePreview: () => store.togglePreview(),
  onCamera: (kind) => {
    const cam = cameraCtl.value;
    if (!cam) return;
    if (kind === 'left') cam.rotateBy(-Math.PI / 8);
    else if (kind === 'right') cam.rotateBy(Math.PI / 8);
    else if (kind === 'zoomin') cam.zoomBy(0.88);
    else if (kind === 'zoomout') cam.zoomBy(1.12);
    else cam.reset();
  },
});

watch(
  () => settings.muted,
  (m) => store.audio.setMuted(m),
  { immediate: true },
);

watch(
  () => [cols.value, rows.value],
  ([c, r]) => {
    scene.value?.setGridSize(c, r);
    voxels.value?.setGrid(c, r);
    waterFx.value?.setGrid(c, r);
    effects.value?.setGrid(c, r);
    // Front view fills the viewport exactly, so a stale fit would clip columns.
    cameraCtl.value?.refit();
  },
);

/** Keep the front-on framing correct when the panel resizes or the phone rotates. */
function refitCamera(): void {
  cameraCtl.value?.refit();
}

watch(
  // Keyed on the run id, not the level id: a retry reuses the same level
  // object, so a watcher on `level.id` never fires and the win pull-back
  // framing (plus the spent `recordedRun` flag) would survive into the retry.
  () => store.runId,
  () => {
    const cam = cameraCtl.value;
    const levelId = store.level?.id ?? '';
    const sameBoard = levelId === currentLevelId;
    currentLevelId = levelId;
    recordedRun = false;
    drainFactor.value = 1;
    wow.value?.reset();
    effects.value?.clear();
    dropTrails.reset();
    dropCursor.value = 0;
    if (!cam) return;

    if (!sameBoard) {
      // A different board is a different scene: drop any leftover pull-back or
      // manual zoom and refit from scratch. This is what makes every tutorial
      // step open at exactly the same size as step 1.
      poseBeforeWin = null;
      cam.refitForNewScene();
    } else if (poseBeforeWin) {
      // Same board, played again: give the player back the view they left.
      cam.restorePose(poseBeforeWin);
      poseBeforeWin = null;
    } else {
      // Same board restarted mid-run (R / 重开本关): nothing pulled the camera
      // away, so leave the current view untouched.
      cam.keepView();
    }
  },
);

// Record progress exactly once when a result appears.
watch(
  () => store.showResult,
  (shown) => {
    if (!shown || !store.result) return;
    const res = store.result;
    const lvl = store.level;
    if (!lvl) return;
    // Tutorial levels are coaching, not contracts: they must not pollute the
    // contract star/score records or the share history.
    const bucket = recordActionFor(lvl.id, store.mode);
    if (bucket === 'none') return;
    if (bucket === 'level') {
      progress.recordLevel(lvl.id, res.stars, res.score, res.blocksUsed, res.won);
    } else if (bucket === 'daily') {
      progress.recordDaily(todayKey(), res.score, res.blocksUsed, res.won);
    } else if (bucket === 'endless') {
      progress.recordEndless(res.score);
    }
    if (res.won && store.shareCode) {
      progress.addShare({
        code: store.shareCode,
        levelId: lvl.id,
        levelName: lvl.name,
        score: res.score,
        won: true,
        date: Date.now(),
      });
    }
  },
);

onMounted(() => {
  buildScene();
  setEnabled(true);
  window.addEventListener('resize', refitCamera);
});

onBeforeUnmount(() => {
  loop?.stop();
  window.removeEventListener('resize', refitCamera);
  cameraCtl.value?.dispose();
  voxels.value?.dispose();
  waterFx.value?.dispose();
  effects.value?.dispose();
  scene.value?.dispose();
});

defineExpose({
  rotate: (d: number) => cameraCtl.value?.rotateBy(d),
  zoom: (f: number) => cameraCtl.value?.zoomBy(f),
  resetCamera: () => cameraCtl.value?.reset(),
});
</script>

<template>
  <div ref="host" class="canvas-host" :class="{ 'is-active': props.active }">
    <canvas ref="canvas" class="game-canvas" aria-label="Waterworks 3D 游戏画面"></canvas>
    <div v-if="error" class="canvas-error">
      <strong>画面无法启动</strong>
      <span>{{ error }}</span>
      <span class="hint">请确认浏览器已启用 WebGL。</span>
    </div>
    <div class="canvas-vignette" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.canvas-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 35%, #16222e 0%, #0b1118 65%, #070b10 100%);
}
.game-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: grab;
}
.game-canvas:active {
  cursor: grabbing;
}
.canvas-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 52%, rgba(0, 0, 0, 0.55) 100%);
}
.canvas-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
  color: #ffd9a0;
  background: rgba(9, 14, 20, 0.9);
  text-align: center;
  padding: 2rem;
}
.canvas-error .hint {
  color: #8fa9bd;
  font-size: 0.85rem;
}
</style>

