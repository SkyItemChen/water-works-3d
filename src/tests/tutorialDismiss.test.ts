
/**
 * Coaching bubble visibility.
 *
 * The bubble must be foldable without stopping the tutorial, and must come back
 * on its own at exactly two moments: when the current step is completed, and
 * when the next step starts. Any other behaviour either hides a finished step
 * (player never sees ✔ / 下一步) or keeps nagging while the player is working.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useTutorialStore } from '../stores/tutorialStore';
import { useGameStore } from '../stores/gameStore';

describe('tutorial bubble dismissal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function start(): { tutorial: ReturnType<typeof useTutorialStore>; game: ReturnType<typeof useGameStore> } {
    const tutorial = useTutorialStore();
    const game = useGameStore();
    tutorial.startTutorial();
    return { tutorial, game };
  }

  it('starts open', () => {
    const { tutorial } = start();
    expect(tutorial.running).toBe(true);
    expect(tutorial.dismissed).toBe(false);
  });

  it('dismiss() folds the bubble but keeps the tutorial running', () => {
    const { tutorial } = start();
    tutorial.dismiss();
    expect(tutorial.dismissed).toBe(true);
    expect(tutorial.running).toBe(true);
    expect(tutorial.step?.stepId).toBe('t01');
  });

  it('reopen() brings the same step back without advancing', () => {
    const { tutorial } = start();
    tutorial.dismiss();
    tutorial.reopen();
    expect(tutorial.dismissed).toBe(false);
    expect(tutorial.step?.stepId).toBe('t01');
    expect(tutorial.state.stepIndex).toBe(0);
  });

  it('completing a step re-opens a dismissed bubble', () => {
    const { tutorial } = start();
    tutorial.dismiss();
    expect(tutorial.dismissed).toBe(true);

    // This is the same edge TutorialOverlay reads: the predicate fires while the
    // bubble is closed, so the player must be shown the ✔.
    tutorial.notifyStepComplete();
    expect(tutorial.satisfied).toBe(true);
    expect(tutorial.dismissed).toBe(false);
  });

  it('starting the next step re-opens it even if it were somehow still closed', () => {
    const { tutorial } = start();
    tutorial.notifyStepComplete();
    tutorial.next();
    expect(tutorial.state.stepIndex).toBe(1);
    expect(tutorial.dismissed).toBe(false);
    expect(tutorial.satisfied).toBe(false);
  });

  it('closing a completed bubble does not undo the completion', () => {
    const { tutorial } = start();
    tutorial.notifyStepComplete();
    tutorial.dismiss();
    expect(tutorial.satisfied).toBe(true);
    expect(tutorial.dismissed).toBe(true);
    // The next button only depends on `satisfied`, so it stays available.
    tutorial.next();
    expect(tutorial.state.stepIndex).toBe(1);
  });

  it('a fresh tutorial always opens the bubble again', () => {
    const { tutorial } = start();
    tutorial.dismiss();
    tutorial.startTutorial();
    expect(tutorial.dismissed).toBe(false);
    expect(tutorial.state.stepIndex).toBe(0);
  });

  it('dismissing outside a tutorial is a no-op', () => {
    const tutorial = useTutorialStore();
    tutorial.dismiss();
    expect(tutorial.dismissed).toBe(false);
  });

  it('skip and finish clear the dismissed flag', () => {
    const { tutorial } = start();
    tutorial.dismiss();
    tutorial.skip();
    expect(tutorial.running).toBe(false);
    expect(tutorial.dismissed).toBe(false);
  });
});
