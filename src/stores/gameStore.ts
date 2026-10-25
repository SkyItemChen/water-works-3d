/**
 * Central Pinia store for a run.
 *
 * The store owns the GameEngine (kept in a shallowRef so Vue never walks the
 * typed arrays), all UI-facing state, and the pause / result / replay flow.
 * Rendering reads the engine directly from GameCanvas; the store only publishes
 * a coarse HUD snapshot a few times per second.
 */

import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { GameEngine, type Action } from '../game/core/engine';
import { contractLevels, endlessLevel, isTutorialLevelId, levelById } from '../game/core/level';
import { publishesShareCode, recordsProgress } from '../game/core/presentation';
import { dailyLevel, todayKey } from '../game/core/daily';
import { buildRunResult } from '../game/core/replay';
import { decodeShareCode, encodeShareCode } from '../game/core/shareCode';
import { drainScore, finalScore } from '../game/core/scoring';
import type {
  EngineSnapshot,
  GameMode,
  LevelDefinition,
  ReplayOp,
  ReplayPayload,
  RunResult,
  SimEvent,
  SimPreview,
} from '../game/core/types';
import { useAudio } from '../game/composables/useAudio';

export type Screen = 'menu' | 'levels' | 'daily' | 'game' | 'editor' | 'replay';

export interface ReplaySession {
  payload: ReplayPayload;
  playing: boolean;
  stepIndex: number;
  levelName: string;
}

const audio = useAudio();

export const useGameStore = defineStore('game', () => {
  // --- Screen + level selection -------------------------------------------
  const screen = ref<Screen>('menu');
  const mode = ref<GameMode>('contract');
  /** Where a custom playtest returns when the player leaves the run. */
  const runReturnScreen = ref<Screen>('menu');
  const level = shallowRef<LevelDefinition | null>(null);
  const engine = shallowRef<GameEngine | null>(null);

  // --- Runtime UI state ----------------------------------------------------
  const paused = ref(false);
  /**
   * Tutorial briefing gate: while a coached step's instruction is still on
   * screen the run is held — no tick, no piece input. It is *not* `paused` (no
   * pause menu, and the water does not move either) and it is not a rule:
   * nothing about the gate ever reaches the engine, the hash, a replay or a
   * share code.
   *
   * Only the tutorial store writes it.
   */
  const coachHold = ref(false);
  const snapshot = shallowRef<EngineSnapshot | null>(null);
  const preview = shallowRef<SimPreview | null>(null);
  const showResult = ref(false);
  const result = shallowRef<RunResult | null>(null);
  const shareCode = ref('');
  const shareFeedback = ref('');
  const draining = ref(false);
  /**
   * Presentation switch, set by the tutorial store before a coached step starts:
   * an intermediate tutorial step ends in a "win" but must not play the contract
   * win treatment (camera pull-back, result card). Never read by the engine.
   */
  const suppressWinPresentation = ref(false);
  /**
   * Presentation-only: was the current run started as a coached tutorial step?
   * Kept apart from suppressWinPresentation because that flag is reset on every
   * new engine, while a retry of the very same step must stay coached.
   */
  let coachedRun = false;
  const winHoldMs = 3400;

  const replaySession = shallowRef<ReplaySession | null>(null);
  const replaySpeed = ref(1);

  const pendingFx: SimEvent[] = [];
  const fxVersion = ref(0);
  const lastWinId = ref(0);
  /**
   * Monotonic id of the loaded run. Bumped by every new engine, including a
   * restart of the very same level: the level object is reused in that case,
   * so nothing else can tell a retry from an idle frame. The canvas keys its
   * per-board reset (camera framing, drain VFX) on this, never on level.id.
   */
  const runId = ref(0);

  let hudTimer = 0;
  /** runId that already handed a verdict to the result flow (see settleRun). */
  let settledRunId = -1;
  let winTimer: ReturnType<typeof setTimeout> | null = null;
  let previewTimer = 0;
  let lastEventCursor = 0;

  // --- Derived -------------------------------------------------------------
  const levels = computed(() => contractLevels());
  const liveScore = computed(() => {
    const e = engine.value;
    if (!e) return 0;
    return finalScore(
      e.ledger,
      e.blocksUsed,
      e.blockLimit,
      e.status === 'won' || e.status === 'lost',
    );
  });
  const isEndless = computed(() => mode.value === 'endless');
  const previewEnabled = ref(true);

  function clearTimers(): void {
    if (winTimer) {
      clearTimeout(winTimer);
      winTimer = null;
    }
  }

  // --- Lifecycle -----------------------------------------------------------
  function newEngine(levelDef: LevelDefinition, gameMode: GameMode): GameEngine {
    clearTimers();
    paused.value = false;
    showResult.value = false;
    result.value = null;
    shareCode.value = '';
    shareFeedback.value = '';
    draining.value = false;
    lastEventCursor = 0;
    hudTimer = 0;
    previewTimer = 0;
    pendingFx.length = 0;
    level.value = markRaw(levelDef);
    mode.value = gameMode;
    suppressWinPresentation.value = false;
    coachedRun = false;
    const e = new GameEngine({ level: levelDef, mode: gameMode });
    engine.value = e;
    runId.value += 1;
    screen.value = 'game';
    publish(true);
    return e;
  }

  /**
   * Load a level. `coached` is a presentation-only flag: a coached step wins like
   * any other level but must not play the contract finish (pull-back + result
   * card). It is passed explicitly by the tutorial store and never reaches the
   * engine, the state hash, a share code or a replay.
   */
  function startLevel(levelId: string, opts?: { coached?: boolean }): void {
    const def = levelById(levelId);
    if (!def) return;
    audio.init();
    runReturnScreen.value = 'menu';
    newEngine(def, 'contract');
    coachedRun = opts?.coached === true;
    suppressWinPresentation.value = coachedRun;
    audio.play('ui');
  }

  function startIndex(index: number): void {
    const def = levels.value.find((l) => l.index === index) ?? levels.value[0];
    if (def) startLevel(def.id);
  }

  function startDaily(dateKey = todayKey()): void {
    audio.init();
    runReturnScreen.value = 'menu';
    newEngine(dailyLevel(dateKey), 'daily');
    audio.play('ui');
  }

  function startEndless(): void {
    audio.init();
    runReturnScreen.value = 'menu';
    newEngine(endlessLevel(Date.now() % 100000), 'endless');
    audio.play('ui');
  }

  /** Play an editor draft without recording stars, scores or share history. */
  function startCustomLevel(levelDef: LevelDefinition): void {
    audio.init();
    runReturnScreen.value = 'editor';
    newEngine(levelDef, 'editor');
    audio.play('ui');
  }

  function restart(): void {
    if (!level.value) return;
    const coached = coachedRun;
    newEngine(level.value, mode.value);
    // A retry of an intermediate tutorial step is still a coached step: losing
    // its coaching flag would make the retry end in a contract-style result card.
    if (coached) {
      coachedRun = true;
      suppressWinPresentation.value = true;
    }
    audio.play('ui');
  }

  function toMenu(): void {
    clearTimers();
    engine.value = null;
    paused.value = false;
    showResult.value = false;
    result.value = null;
    draining.value = false;
    suppressWinPresentation.value = false;
    runReturnScreen.value = 'menu';
    screen.value = 'menu';
  }

  /** Leave the current run and return to where it was launched from. */
  function leaveRun(): void {
    const target = runReturnScreen.value;
    clearTimers();
    engine.value = null;
    paused.value = false;
    showResult.value = false;
    result.value = null;
    draining.value = false;
    suppressWinPresentation.value = false;
    runReturnScreen.value = 'menu';
    screen.value = target;
  }

  function openLevels(): void {
    screen.value = 'levels';
    audio.play('ui');
  }

  function openDaily(): void {
    screen.value = 'daily';
    audio.play('ui');
  }

  function openEditor(): void {
    screen.value = 'editor';
    audio.play('ui');
  }

  // --- Pause ---------------------------------------------------------------
  function togglePause(): void {
    if (screen.value !== 'game' || showResult.value) return;
    // The briefing is already a modal gate; a pause menu on top of it is noise.
    if (coachHold.value) return;
    paused.value = !paused.value;
    audio.play('ui');
  }

  function setPaused(v: boolean): void {
    paused.value = v;
  }

  /** Owned by the tutorial store: see `coachHold`. */
  function setCoachHold(v: boolean): void {
    coachHold.value = v;
  }

  // --- Action dispatch -----------------------------------------------------
  function dispatch(a: Action): void {
    const e = engine.value;
    if (!e || paused.value || coachHold.value || screen.value !== 'game') return;
    if (e.status !== 'playing') return;
    const before = e.piece?.kind;
    const applied = e.handleAction(a);
    if (!applied) {
      if (a === 'H' && e.holdUsed) audio.play('ui');
      settleRun();
      return;
    }
    if (a === 'C') audio.play('rotate');
    else if (a === 'H') audio.play('hold');
    else if (a === 'A') audio.play('drop');
    else if (a !== 'D') audio.play('move');
    else audio.play('move');
    if ((a === 'A' || a === 'H') && before !== e.piece?.kind) audio.play('lock');
    publish(true);
    // A hard drop of the final block (blockLimit reached), or a hold that leaves
    // no room for the incoming piece, ends the run *inside* handleAction - not
    // inside step(). Without handing over to the result flow here the loop just
    // stops advancing (status !== 'playing') and the board freezes with no card.
    settleRun();
  }

  // --- Per-tick advance ----------------------------------------------------
  function stepOnce(): void {
    const e = engine.value;
    if (!e || paused.value || coachHold.value || screen.value !== 'game') return;
    if (e.status !== 'playing') return;

    const prevBlocks = e.blocksUsed;
    e.step();
    const events = e.lastEvents;

    // Drain / mix / collapse → sound + effects queue.
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'drain' && ev.amount > 0.001) {
        audio.play((ev.dirty ?? 0) > (ev.clean ?? 0) ? 'drainDirty' : 'drainClean');
        pendingFx.push(ev);
      } else if (ev.type === 'sandCollapse' || ev.type === 'pipeBurst' || ev.type === 'soilCrack') {
        audio.play('burst');
        pendingFx.push(ev);
      } else if (ev.type === 'mix' && Math.random() < 0.25) {
        pendingFx.push(ev);
      } else if (ev.type === 'overflow') {
        pendingFx.push(ev);
      }
    }
    if (pendingFx.length > 80) pendingFx.splice(0, pendingFx.length - 80);
    if (pendingFx.length) fxVersion.value++;

    if (e.blocksUsed !== prevBlocks) {
      audio.play('lock');
      previewTimer = 0;
      preview.value = null;
      publish(true);
    }

    // `e.step()` can end the run; re-read the status through the engine's
    // public field so TypeScript does not keep the pre-step narrowing.
    if (settleRun()) return;

    hudTimer += 1 / 60;
    if (hudTimer >= 0.1) {
      hudTimer = 0;
      publish(false);
    }
  }

  // --- Snapshot ------------------------------------------------------------
  function publish(refreshPreview: boolean): void {
    const e = engine.value;
    if (!e) {
      snapshot.value = null;
      return;
    }
    if (refreshPreview && previewEnabled.value && e.status === 'playing') {
      preview.value = markRaw(e.preview(3));
    }
    const view = e.view();
    const snap: EngineSnapshot = {
      cols: view.cols,
      rows: view.rows,
      tick: view.tick,
      grid: view.grid,
      clean: view.clean,
      dirty: view.dirty,
      pressure: view.pressure,
      meta: view.meta,
      piece: view.piece
        ? {
            kind: view.piece.kind,
            cells: view.piece.cells,
            x: view.piece.x,
            y: view.piece.y,
            color: view.piece.color,
            material: view.piece.material,
            // Pipes and valves move water along `dir`; the viewport draws it.
            dir: view.piece.dir,
          }
        : null,
      ghostY: view.ghostY,
      next: view.next,
      hold: view.hold,
      holdUsed: view.holdUsed,
      score: liveScore.value,
      blocksUsed: view.blocksUsed,
      blockLimit: view.blockLimit,
      status: view.status,
      ledger: view.ledger,
      goals: view.goals,
      dangerCols: view.dangerCols,
      waterline: view.waterline,
      pollutionStrikes: view.pollutionStrikes,
      seed: view.seed,
      mode: view.mode,
      levelId: view.levelId,
      levelName: view.levelName,
      mixCells: view.mixture,
      prefillPreview: preview.value ?? {
        clean: new Float64Array(view.cols * view.rows),
        dirty: new Float64Array(view.cols * view.rows),
        steps: 0,
        topRow: [],
      },
    };
    snapshot.value = markRaw(snap);
  }

  function refreshPreview(): void {
    const e = engine.value;
    if (!e || e.status !== 'playing' || !previewEnabled.value) {
      preview.value = null;
      return;
    }
    preview.value = markRaw(e.preview(3));
  }

  function togglePreview(): void {
    previewEnabled.value = !previewEnabled.value;
    refreshPreview();
    publish(true);
    audio.play('ui');
  }

  // --- End of run ----------------------------------------------------------
  function onWin(): void {
    const e = engine.value;
    if (!e) return;
    audio.play('win');
    publish(true);
    const run = buildRunResult(e);
    result.value = markRaw(run);
    lastWinId.value += 1;

    const allowShare = e.mode !== 'editor' && publishesShareCode(e.level.id);
    if (allowShare) {
      const payload: ReplayPayload = {
        v: 1,
        l: e.level.id,
        s: e.seed,
        // The full op stream is what makes the replay reproduce the player's
        // actual motion: every sideways step, every soft-drop row, and the slam
        // when space is pressed. `pl` stays as a fallback for older readers;
        // v5 playback prefers `o` whenever it is present.
        o: e.ops.map((o) => ({ t: o.t, a: o.a })),
        pl: e.placements.map((pl) => ({ ...pl })),
        c: run.score,
        h: run.hash,
        r: 'won',
        tt: e.tick,
        at: Date.now(),
      };
      shareCode.value = encodeShareCode(payload);
    } else {
      shareCode.value = '';
    }

    // A coached tutorial step wins like any level but is not a contract finish:
    // the basin still drains (pure VFX), yet there is no result card and the
    // camera is left alone so the next step looks identical to this one.
    draining.value = true;
    if (suppressWinPresentation.value) return;

    winTimer = setTimeout(() => {
      showResult.value = true;
      draining.value = false;
      winTimer = null;
    }, winHoldMs);
  }
  function onLose(): void {
    const e = engine.value;
    if (!e) return;
    audio.play('lose');
    publish(true);
    const run = buildRunResult(e);
    result.value = markRaw(run);
    showResult.value = true;
  }

  /**
   * Hand a finished run over to the result flow, exactly once.
   *
   * The engine can reach a verdict from two places: step() (overflow, pollution,
   * a blocked drain, goals met) and handleAction() (the final block locking, or
   * a blocked spawn after a hold). Both must route through here - skipping the
   * action path left status !== 'playing' with no card on screen, which is the
   * bug where the board went silent once the last block was placed.
   *
   * Returns true when the run is over, so callers can stop their tick bookkeeping.
   */
  function settleRun(): boolean {
    const e = engine.value;
    if (!e) return false;
    const status: string = e.status;
    if (status === 'playing') return false;
    // Idempotent per run: dispatch() and stepOnce() may both observe the same
    // verdict, and a second onWin() would arm a duplicate result timer.
    if (settledRunId === runId.value) return true;
    settledRunId = runId.value;
    if (status === 'won') onWin();
    else onLose();
    return true;
  }

  function closeResult(): void {
    showResult.value = false;
  }

  // --- Replay --------------------------------------------------------------
  function loadReplayCode(code: string): { ok: boolean; error?: string } {
    const decoded = decodeShareCode(code);
    if (!decoded.ok || !decoded.payload) {
      return { ok: false, error: decoded.error ?? '无法解析短码' };
    }
    replaySession.value = {
      payload: decoded.payload,
      playing: false,
      stepIndex: 0,
      levelName: decoded.levelName ?? decoded.payload.l,
    };
    screen.value = 'replay';
    return { ok: true };
  }

  function closeReplay(): void {
    replaySession.value = null;
    screen.value = 'menu';
  }

  function addFx(ev: SimEvent): void {
    void ev;
  }

  function consumeFx(): SimEvent[] {
    if (!pendingFx.length) return [];
    const out = pendingFx.splice(0, pendingFx.length);
    return out;
  }

  return {
    // state
    screen,
    mode,
    level,
    engine,
    paused,
    coachHold,
    snapshot,
    preview,
    showResult,
    result,
    shareCode,
    shareFeedback,
    draining,
    suppressWinPresentation,
    replaySession,
    replaySpeed,
    previewEnabled,
    pendingFx,
    fxVersion,
    lastWinId,
    runId,
    audio,
    winHoldMs,
    // derived
    levels,
    liveScore,
    isEndless,
    // actions
    startLevel,
    startIndex,
    startDaily,
    startEndless,
    startCustomLevel,
    restart,
    toMenu,
    leaveRun,
    openLevels,
    openDaily,
    openEditor,
    togglePause,
    setPaused,
    setCoachHold,
    dispatch,
    stepOnce,
    publish,
    refreshPreview,
    togglePreview,
    onWin,
    onLose,
    closeResult,
    loadReplayCode,
    closeReplay,
    addFx,
    consumeFx,
  };
});

