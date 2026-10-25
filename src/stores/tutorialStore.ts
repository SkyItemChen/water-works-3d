/**
 * Tutorial store — the bypass observer that tracks tutorial progress.
 *
 * It watches the game store's published snapshots and turns consecutive
 * snapshots into discrete observations (a piece locked / drain counters moved /
 * a fresh mix appeared). Those observations are evaluated by the pure
 * predicates in `core/tutorial.ts`.
 *
 * Hard rules enforced here:
 *  - nothing in this file writes to the engine;
 *  - progression is driven only by discrete engine snapshots (no wall clock);
 *  - tutorial state never reaches getStateHash(), share codes or replays.
 *
 * Flow:
 *  1. `startTutorial()` opens the tutorial's own landing page (step list +
 *     开始 / 跳过). Skipping is offered *only* there.
 *  2. `begin()` loads step 1 with its briefing bubble open and the run held
 *     (`game.coachHold`), so the player reads first and plays after closing it.
 *  3. A satisfied predicate re-opens the bubble with ✔ and the store advances
 *     to the next step by itself — there is no 下一步 button any more.
 */

import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { useGameStore } from './gameStore';
import { useProgressStore } from './progressStore';
import { isTutorialLevelId, tutorialLevels } from '../game/core/level';
import {
  advanceTutorial,
  buildObservation,
  createTutorialState,
  currentStep,
  forceAdvance,
  progressLabel,
  skipTutorial,
  type TutorialSnapshotLike,
} from '../game/core/tutorial';
import type { BlockKind, TutorialState, TutorialStepData } from '../game/core/types';

/** How long the ✔ stays on screen before the next step loads itself. */
const AUTO_ADVANCE_MS = 900;

export const useTutorialStore = defineStore('tutorial', () => {
  const game = useGameStore();
  const progress = useProgressStore();

  const steps = shallowRef<TutorialStepData[]>(
    tutorialLevels()
      .map((l) => l.tutorial)
      .filter((s): s is TutorialStepData => !!s),
  );
  const state = ref<TutorialState>(createTutorialState(steps.value));
  const running = ref(false);
  /** The tutorial landing page (step list + 开始教程 / 跳过教程) is open. */
  const intro = ref(false);
  /** True once the current step's predicate has been satisfied. */
  const satisfied = ref(false);
  /**
   * The player closed the coach bubble to play.
   *
   * Closing it is what *starts* the step: while the bubble is open the run is
   * held, so the instruction is read before the first block moves. Observation
   * keeps running behind it, and completing the step re-opens it for the ✔.
   */
  const dismissed = ref(false);
  /**
   * The current step's briefing has been acknowledged at least once.
   *
   * Re-opening the bubble from the collapsed chip afterwards is a *read*, not a
   * briefing: it must not freeze a run that is already in progress.
   */
  const briefed = ref(false);

  let prevBlocksUsed = 0;
  let prevPieceKind: BlockKind | null = null;
  let prevMixCells = 0;
  let prevLevelId = '';
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;

  const step = computed<TutorialStepData | null>(() => currentStep(steps.value, state.value));
  const label = computed(() => progressLabel(state.value));
  const total = computed(() => state.value.totalSteps);
  const isLastStep = computed(() => state.value.stepIndex >= state.value.totalSteps - 1);

  /**
   * True while the run must not advance.
   *
   * Either the step briefing has not been acknowledged yet, or the step was just
   * cleared and the overlay is holding the ✔ before moving on. The game store
   * only reads the published flag (`coachHold`); this computed is the single
   * place that decides it.
   */
  const holdRun = computed(() => {
    if (!running.value || intro.value) return false;
    if (satisfied.value) return true;
    return !dismissed.value && !briefed.value;
  });

  // flush: 'sync' so the gate is in place before the next animation frame.
  watch(holdRun, (held) => game.setCoachHold(held), { flush: 'sync' });

  function clearAdvance(): void {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  }

  function resetCounters(): void {
    prevBlocksUsed = 0;
    prevPieceKind = null;
    prevMixCells = 0;
    prevLevelId = '';
  }

  function reset(): void {
    clearAdvance();
    state.value = createTutorialState(steps.value);
    satisfied.value = false;
    dismissed.value = false;
    briefed.value = false;
    intro.value = false;
    resetCounters();
    game.setCoachHold(false);
  }

  /**
   * Close the briefing (or fold the bubble away again). Closing the briefing is
   * what lets the step start moving.
   */
  function dismiss(): void {
    if (!running.value) return;
    dismissed.value = true;
    briefed.value = true;
  }

  /** Show the bubble again without changing the step. Never re-arms the hold. */
  function reopen(): void {
    if (!running.value) return;
    dismissed.value = false;
  }

  /**
   * Load the level for the step the pointer currently sits on.
   *
   * Intermediate steps are *coached*: their win is a mid-tutorial checkpoint, so
   * the presentation layer skips the contract finish (camera pull-back + result
   * card). The last step is a real finish and plays the normal win — it still
   * writes no stars or best scores, because tutorial levels are never contracts.
   */
  function loadCurrentStep(): void {
    const target = tutorialLevels()[state.value.stepIndex];
    if (!target) {
      finish();
      return;
    }
    game.startLevel(target.id, { coached: !isLastStep.value });
  }

  /** Open one step: briefing bubble on screen and the run held. */
  function startStep(): void {
    clearAdvance();
    satisfied.value = false;
    dismissed.value = false;
    briefed.value = false;
    // Set the hold synchronously, before the level exists: the computed watcher
    // would only fire one microtask later, and the first frame must be gated.
    game.setCoachHold(true);
    loadCurrentStep();
  }

  /** Enter the tutorial: open its landing page, nothing is loaded yet. */
  function startTutorial(): void {
    reset();
    running.value = true;
    intro.value = true;
    game.toMenu();
  }

  /** Leave the landing page and start step 1. */
  function begin(): void {
    if (!running.value) return;
    intro.value = false;
    startStep();
  }

  /** Leave the tutorial without marking it complete. */
  function quitTutorial(): void {
    clearAdvance();
    running.value = false;
    intro.value = false;
    dismissed.value = false;
    briefed.value = false;
    game.setCoachHold(false);
    game.toMenu();
  }

  /** "跳过教程" — offered on the landing page; counts as seen. */
  function skip(): void {
    clearAdvance();
    state.value = skipTutorial(steps.value, state.value);
    running.value = false;
    intro.value = false;
    satisfied.value = false;
    dismissed.value = false;
    briefed.value = false;
    game.setCoachHold(false);
    progress.markTutorialDone();
    game.toMenu();
  }

  /** Move to the next step, loading its level. Marks the tutorial done at the end. */
  function next(): void {
    if (!running.value || state.value.done) return;
    clearAdvance();
    state.value = forceAdvance(steps.value, state.value);
    if (state.value.done) {
      finish();
      return;
    }
    startStep();
  }

  function finish(): void {
    clearAdvance();
    running.value = false;
    intro.value = false;
    satisfied.value = false;
    dismissed.value = false;
    briefed.value = false;
    game.setCoachHold(false);
    progress.markTutorialDone();
    game.toMenu();
  }

  /**
   * Completing a step shows the ✔ and then advances by itself.
   *
   * Keyed on the *satisfied* edge (not on every snapshot) so the timeout is
   * armed exactly once per step. The pointer is held at the finished step while
   * the ✔ is on screen; `next()` is what actually moves it.
   */
  watch(
    satisfied,
    (done) => {
      if (!running.value || intro.value) return;
      if (!done) return;
      // A completed step is never hidden: the player must see the ✔.
      dismissed.value = false;
      clearAdvance();
      advanceTimer = setTimeout(() => {
        advanceTimer = null;
        if (satisfied.value) next();
      }, AUTO_ADVANCE_MS);
    },
    { flush: 'sync' },
  );

  /**
   * A fresh run of the same step (R, 重试本关) is a fresh briefing: the bubble
   * comes back and the run is held again, otherwise the player would retry with
   * the instruction nowhere on screen.
   */
  watch(
    () => game.runId,
    () => {
      if (!running.value || intro.value) return;
      clearAdvance();
      satisfied.value = false;
      dismissed.value = false;
      briefed.value = false;
      game.setCoachHold(true);
    },
  );

  /**
   * Read one snapshot pair and evaluate the current step. Called by the watcher
   * below; exposed for tests and for the replay path (which never runs it).
   */
  function observe(prev: TutorialSnapshotLike, next: TutorialSnapshotLike): void {
    if (!running.value || state.value.done) return;
    if (!isTutorialLevelId(next.levelId ?? '')) return;

    // A new level resets the change-detection anchors, otherwise the first
    // snapshot of the next step would look like a huge jump.
    if (next.levelId !== prevLevelId) {
      prevLevelId = next.levelId ?? '';
      prevBlocksUsed = next.blocksUsed;
      prevPieceKind = next.piece?.kind ?? null;
      prevMixCells = next.mixCells.length;
      satisfied.value = false;
      return;
    }

    if (satisfied.value) {
      // Already cleared: waiting for the ✔ beat / auto-advance.
      prevBlocksUsed = next.blocksUsed;
      prevPieceKind = next.piece?.kind ?? prevPieceKind;
      return;
    }

    const obs = buildObservation(prev, next, prevPieceKind);
    // A mix lingers for several frames; only a fresh transition counts.
    const freshMix = next.mixCells.length > 0 && prevMixCells === 0;
    prevMixCells = next.mixCells.length;

    const after = advanceTutorial(steps.value, state.value, { ...obs, mixed: obs.mixed && freshMix });
    if (after !== state.value) {
      // The predicate fired. Hold the pointer on the current step so the ✔ is
      // visible; the satisfied watcher moves on afterwards.
      satisfied.value = true;
    }

    prevBlocksUsed = next.blocksUsed;
    prevPieceKind = next.piece?.kind ?? prevPieceKind;
  }

  watch(
    () => game.snapshot,
    (snap) => {
      if (!snap || !running.value) return;
      if (!isTutorialLevelId(snap.levelId)) return;
      const prev: TutorialSnapshotLike = {
        blocksUsed: prevBlocksUsed,
        piece: prevPieceKind ? { kind: prevPieceKind } : null,
        ledger: { drainedClean: 0, drainedDirty: 0 },
        mixCells: [],
        levelId: snap.levelId,
      };
      const next: TutorialSnapshotLike = {
        blocksUsed: snap.blocksUsed,
        piece: snap.piece ? { kind: snap.piece.kind } : null,
        ledger: snap.ledger,
        mixCells: snap.mixCells,
        levelId: snap.levelId,
      };
      observe(prev, next);
      // A won level satisfies the step too — the player must never be stuck
      // waiting on a predicate they already achieved by finishing the level.
      if (snap.status === 'won') satisfied.value = true;
    },
    { flush: 'sync' },
  );

  /**
   * A reached level goal also satisfies the step: the tutorial's own predicate
   * usually fires first, but a win must never leave the player stuck.
   */
  function notifyStepComplete(): void {
    if (!running.value || state.value.done) return;
    satisfied.value = true;
  }

  // Winning the tutorial level counts as clearing its step. Driven by the
  // store's own result flag — still a discrete game event, not a clock.
  // A *lost* run raises the same flag (the failure card is shown for coached
  // steps too), so the verdict has to be checked as well: ticking the step on a
  // failure would advance past a board the player never solved.
  watch(
    () => game.showResult,
    (shown) => {
      if (!shown || !running.value) return;
      if (!game.result?.won) return;
      notifyStepComplete();
    },
  );

  return {
    running,
    intro,
    steps,
    state,
    step,
    satisfied,
    dismissed,
    briefed,
    holdRun,
    label,
    total,
    isLastStep,
    startTutorial,
    begin,
    quitTutorial,
    skip,
    next,
    notifyStepComplete,
    dismiss,
    reopen,
    reset,
    observe,
  };
});
