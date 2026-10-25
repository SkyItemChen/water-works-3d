/**
 * Tutorial state machine — PURE, framework-free.
 *
 * This module is a BYPASS OBSERVER of the game. It reads discrete engine
 * observations (a piece locked, drain counters changed, a mix happened) and
 * decides whether the current tutorial step is satisfied. It never writes to
 * the engine, never participates in `getStateHash()`, never enters a share
 * code and never influences a replay: `advanceTutorial` takes a state and an
 * observation and returns a NEW state, touching nothing else.
 *
 * No wall-clock time is involved anywhere. Advancement is driven exclusively by
 * engine events, so the same run always produces the same tutorial progress.
 */

import type { BlockKind, TutorialCondition, TutorialObservation, TutorialState, TutorialStepData } from './types';

export type { TutorialObservation, TutorialState } from './types';

/** Build the initial state for a step list. */
export function createTutorialState(steps: TutorialStepData[]): TutorialState {
  return {
    stepIndex: 0,
    totalSteps: steps.length,
    done: steps.length === 0,
    skipped: false,
  };
}

/**
 * Evaluate one predicate against a discrete observation.
 * Pure: no I/O, no time, no randomness.
 */
export function evaluateCondition(cond: TutorialCondition, obs: TutorialObservation): boolean {
  switch (cond.kind) {
    case 'lockKind':
      return obs.lockKind != null && cond.anyOf.indexOf(obs.lockKind) >= 0;
    case 'drainedCleanAtLeast':
      return obs.drainedClean >= cond.amount;
    case 'drainedDirtyAtLeast':
      return obs.drainedDirty >= cond.amount;
    case 'mixed':
      return obs.mixed;
    case 'all':
      return cond.of.every((c) => evaluateCondition(c, obs));
    default:
      return false;
  }
}

/** Current step, or null once the tutorial is finished. */
export function currentStep(steps: TutorialStepData[], state: TutorialState): TutorialStepData | null {
  if (state.done) return null;
  return steps[state.stepIndex] ?? null;
}

/** True when the current step's own predicate is satisfied by `obs`. */
export function isStepSatisfied(steps: TutorialStepData[], state: TutorialState, obs: TutorialObservation): boolean {
  const step = currentStep(steps, state);
  if (!step) return false;
  return evaluateCondition(step.condition, obs);
}

/**
 * Observe one engine event batch. Returns the same state object when nothing
 * changes, so callers can cheaply detect "no progress".
 */
export function advanceTutorial(
  steps: TutorialStepData[],
  state: TutorialState,
  obs: TutorialObservation,
): TutorialState {
  if (state.done || state.skipped) return state;
  if (!isStepSatisfied(steps, state, obs)) return state;
  return stepForward(steps, state);
}

/** Advance one step regardless of predicates (the store's auto-advance). */
export function forceAdvance(steps: TutorialStepData[], state: TutorialState): TutorialState {
  if (state.done || state.skipped) return state;
  return stepForward(steps, state);
}

/** "跳过教程" — finishes immediately, from any step. */
export function skipTutorial(steps: TutorialStepData[], state: TutorialState): TutorialState {
  if (state.done) return state;
  return { stepIndex: steps.length, totalSteps: steps.length, done: true, skipped: true };
}

function stepForward(steps: TutorialStepData[], state: TutorialState): TutorialState {
  const next = state.stepIndex + 1;
  if (next >= steps.length) {
    return { stepIndex: steps.length, totalSteps: steps.length, done: true, skipped: false };
  }
  return { stepIndex: next, totalSteps: steps.length, done: false, skipped: false };
}

/** A neutral observation, useful for tests and for resetting readers. */
export function emptyObservation(): TutorialObservation {
  return { lockKind: null, drainedClean: 0, drainedDirty: 0, mixed: false };
}

/** Progress label such as "2/5". */
export function progressLabel(state: TutorialState): string {
  if (state.totalSteps === 0) return '0/0';
  return `${Math.min(state.stepIndex + 1, state.totalSteps)}/${state.totalSteps}`;
}

export function kindsOf(step: TutorialStepData): readonly BlockKind[] {
  return step.condition.kind === 'lockKind' ? step.condition.anyOf : [];
}

/**
 * The minimal slice of an engine snapshot the tutorial needs. Declared
 * structurally so `core` never imports a store or a renderer.
 */
export interface TutorialSnapshotLike {
  blocksUsed: number;
  piece: { kind: BlockKind } | null;
  ledger: { drainedClean: number; drainedDirty: number };
  mixCells: number[];
  /** optional: lets callers guard on the level being a tutorial level */
  levelId?: string;
}

/**
 * Turn two consecutive engine snapshots into one discrete observation.
 *
 * `prevPieceKind` must be the piece kind seen in the PREVIOUS snapshot: when a
 * piece locks, the new snapshot already shows the next piece, so the locked
 * kind can only be recovered from the snapshot before the block counter moved.
 */
export function buildObservation(
  prev: TutorialSnapshotLike | null,
  next: TutorialSnapshotLike,
  prevPieceKind: BlockKind | null,
): TutorialObservation {
  const locked = prev != null && next.blocksUsed > prev.blocksUsed ? prevPieceKind : null;
  return {
    lockKind: locked,
    drainedClean: next.ledger.drainedClean,
    drainedDirty: next.ledger.drainedDirty,
    mixed: next.mixCells.length > 0,
  };
}
