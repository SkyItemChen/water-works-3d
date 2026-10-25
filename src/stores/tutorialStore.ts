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
 * Advancement is always a discrete step: the predicate marks the current step
 * as "satisfied" (so the overlay can offer 下一步), and the player — or a
 * level win — actually moves the pointer.
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
  /** True once the current step's predicate has been satisfied. */
  const satisfied = ref(false);
  /**
   * The player folded the coach bubble away to get a clear view of the well.
   *
   * Dismissal is presentation-only: observation keeps running, so the step can
   * still complete while the bubble is hidden. When it does, the bubble pops
   * back so the player sees the ✔ and can move on. Starting the next step also
   * re-opens it — a new instruction is never hidden by the previous step's
   * "close".
   */
  const dismissed = ref(false);

  let prevBlocksUsed = 0;
  let prevPieceKind: BlockKind | null = null;
  let prevMixCells = 0;
  let prevLevelId = '';

  const step = computed<TutorialStepData | null>(() => currentStep(steps.value, state.value));
  const label = computed(() => progressLabel(state.value));
  const total = computed(() => state.value.totalSteps);
  const isLastStep = computed(() => state.value.stepIndex >= state.value.totalSteps - 1);

  function resetCounters(): void {
    prevBlocksUsed = 0;
    prevPieceKind = null;
    prevMixCells = 0;
    prevLevelId = '';
  }

  function reset(): void {
    state.value = createTutorialState(steps.value);
    satisfied.value = false;
    dismissed.value = false;
    resetCounters();
  }

  /** Fold the coach bubble away. Progress is unaffected. */
  function dismiss(): void {
    if (!running.value) return;
    dismissed.value = true;
  }

  /** Show the bubble again without changing the step. */
  function reopen(): void {
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

  /** Enter the tutorial and open step 1. */
  function startTutorial(): void {
    reset();
    running.value = true;
    if (tutorialLevels().length) loadCurrentStep();
    else running.value = false;
  }

  /** Leave the tutorial without marking it complete. */
  function quitTutorial(): void {
    running.value = false;
    game.toMenu();
  }

  /** "跳过教程" — available at any time; counts as seen. */
  function skip(): void {
    state.value = skipTutorial(steps.value, state.value);
    running.value = false;
    satisfied.value = false;
    dismissed.value = false;
    progress.markTutorialDone();
    game.toMenu();
  }

  /** Move to the next step, loading its level. Marks the tutorial done at the end. */
  function next(): void {
    if (state.value.done) return;
    state.value = forceAdvance(steps.value, state.value);
    satisfied.value = false;
    // A new instruction must be visible even if the player closed the previous
    // (already completed) bubble.
    dismissed.value = false;
    if (state.value.done) {
      finish();
      return;
    }
    loadCurrentStep();
  }

  function finish(): void {
    running.value = false;
    dismissed.value = false;
    progress.markTutorialDone();
    game.toMenu();
  }

  /**
   * Completing a step always brings the bubble back: the player needs to see the
   * ✔ and press 下一步. This is deliberately keyed on the *satisfied* edge, not
   * on every snapshot, so a hidden bubble stays hidden while the player works.
   */
  watch(
    satisfied,
    (done) => {
      if (done && running.value) dismissed.value = false;
    },
    { flush: 'sync' },
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
      // Already cleared: the overlay is waiting for the player's confirmation.
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
      // The predicate fired. Hold the pointer on the current step so the player
      // confirms with 下一步/完成 — only an explicit click ends the tutorial.
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
  watch(
    () => game.showResult,
    (shown) => {
      if (!shown || !running.value) return;
      notifyStepComplete();
    },
  );

  return {
    running,
    steps,
    state,
    step,
    satisfied,
    dismissed,
    label,
    total,
    isLastStep,
    startTutorial,
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