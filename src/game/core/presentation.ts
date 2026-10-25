/**
 * Run presentation policy — pure, framework-free decisions about how a run's
 * ending is *shown*, as opposed to how it is simulated.
 *
 * Everything here is display-only. Keeping it out of the engine is what stops
 * it from reaching `getStateHash()`, share codes or replays: the hash describes
 * the simulation, never the presentation.
 */

import { isTutorialLevelId } from './level';
import type { GameMode } from './types';

/**
 * Should a win play the full contract treatment (camera pull-back + result card)?
 *
 * Tutorial steps are each a complete level, so every intermediate step ends in a
 * "win". Those must not yank the camera away: the coach advances to the next
 * step and the board has to look exactly as it did on entry. Only the final step
 * earns the normal finish.
 */
export function playsWinCinematic(tutorialRunning: boolean, isLastTutorialStep: boolean): boolean {
  return !tutorialRunning || isLastTutorialStep;
}

/**
 * May this run write contract stars / best scores?
 *
 * Tutorial levels are coaching, not contracts. Answering `false` here is what
 * keeps `progressStore` clean while still letting the tutorial reuse the engine.
 */
export function recordsProgress(levelId: string): boolean {
  return !isTutorialLevelId(levelId);
}

/** May this run produce a share code / share-history entry? */
export function publishesShareCode(levelId: string): boolean {
  return !isTutorialLevelId(levelId);
}

export type RecordAction = 'level' | 'daily' | 'endless' | 'none';

/**
 * Which progress bucket a finished run belongs to. `'none'` is the tutorial
 * answer: coached steps never touch stars, best scores or share history.
 */
export function recordActionFor(levelId: string, mode: GameMode): RecordAction {
  // Editor playtests are disposable: no stars, best scores or share history.
  if (mode === 'editor') return 'none';
  if (!recordsProgress(levelId)) return 'none';
  if (mode === 'daily') return 'daily';
  if (mode === 'endless') return 'endless';
  if (mode === 'replay') return 'none';
  return 'level';
}
