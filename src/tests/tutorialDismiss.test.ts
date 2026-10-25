/**
 * Tutorial briefing + auto-advance.
 *
 * New flow under test:
 *  - the tutorial opens on its own landing page (the only place with 跳过教程);
 *  - a step starts with its prompt open and the run *held* — closing the prompt
 *    is what starts the water;
 *  - clearing the step re-opens the prompt with ✔ and advances by itself, so
 *    there is no 下一步 button left to press.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useTutorialStore } from '../stores/tutorialStore';
import { useGameStore } from '../stores/gameStore';

type Tutorial = ReturnType<typeof useTutorialStore>;
type Game = ReturnType<typeof useGameStore>;

describe('tutorial briefing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function start(): { tutorial: Tutorial; game: Game } {
    const tutorial = useTutorialStore();
    const game = useGameStore();
    tutorial.startTutorial();
    return { tutorial, game };
  }

  it('opens on the landing page without loading a level', () => {
    const { tutorial, game } = start();
    expect(tutorial.running).toBe(true);
    expect(tutorial.intro).toBe(true);
    expect(game.screen).toBe('menu');
    expect(game.level).toBeNull();
    // Nothing is gated yet: there is no board to hold.
    expect(game.coachHold).toBe(false);
  });

  it('begin() loads step 1 with the prompt open and the run held', () => {
    const { tutorial, game } = start();
    tutorial.begin();
    expect(tutorial.intro).toBe(false);
    expect(tutorial.step?.stepId).toBe('t01');
    expect(tutorial.dismissed).toBe(false);
    expect(tutorial.briefed).toBe(false);
    expect(game.screen).toBe('game');
    expect(game.coachHold).toBe(true);
  });

  it('the held run ignores input and does not tick', () => {
    const { tutorial, game } = start();
    tutorial.begin();
    const engine = game.engine!;
    const tick = engine.tick;

    game.dispatch('A');
    game.stepOnce();

    expect(engine.tick).toBe(tick);
    expect(engine.blocksUsed).toBe(0);
  });

  it('closing the prompt starts the step', () => {
    const { tutorial, game } = start();
    tutorial.begin();
    tutorial.dismiss();
    expect(tutorial.dismissed).toBe(true);
    expect(tutorial.briefed).toBe(true);
    expect(tutorial.running).toBe(true);
    expect(game.coachHold).toBe(false);

    game.stepOnce();
    expect(game.engine!.tick).toBe(1);
  });

  it('re-reading the prompt mid-run never freezes the board again', () => {
    const { tutorial, game } = start();
    tutorial.begin();
    tutorial.dismiss();
    tutorial.reopen();
    expect(tutorial.dismissed).toBe(false);
    expect(game.coachHold).toBe(false);
    expect(tutorial.step?.stepId).toBe('t01');
    expect(tutorial.state.stepIndex).toBe(0);
  });

  it('a retry of the same step briefs again', async () => {
    const { tutorial, game } = start();
    tutorial.begin();
    tutorial.dismiss();
    game.restart();
    await nextTick();
    expect(tutorial.dismissed).toBe(false);
    expect(tutorial.briefed).toBe(false);
    expect(game.coachHold).toBe(true);
  });

  it('dismissing outside a tutorial is a no-op', () => {
    const tutorial = useTutorialStore();
    tutorial.dismiss();
    expect(tutorial.dismissed).toBe(false);
  });
});

describe('tutorial auto-advance', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    const tutorial = useTutorialStore();
    tutorial.reset();
  });

  function running(): { tutorial: Tutorial; game: Game } {
    const tutorial = useTutorialStore();
    const game = useGameStore();
    tutorial.startTutorial();
    tutorial.begin();
    tutorial.dismiss();
    return { tutorial, game };
  }

  it('shows the ✔ and moves on by itself, with no button to press', () => {
    const { tutorial, game } = running();
    tutorial.notifyStepComplete();
    expect(tutorial.satisfied).toBe(true);
    // The prompt re-opens for the ✔ and the board is held while it is shown.
    expect(tutorial.dismissed).toBe(false);
    expect(game.coachHold).toBe(true);
    // The pointer has not moved yet: the ✔ beat is on screen.
    expect(tutorial.state.stepIndex).toBe(0);

    vi.advanceTimersByTime(900);

    expect(tutorial.state.stepIndex).toBe(1);
    expect(tutorial.step?.stepId).toBe('t02');
    expect(tutorial.satisfied).toBe(false);
    // The next step opens with its own briefing, so the run stays held.
    expect(tutorial.dismissed).toBe(false);
    expect(game.coachHold).toBe(true);
  });

  it('finishes the tutorial after the last step', () => {
    const { tutorial } = running();
    tutorial.state.stepIndex = tutorial.state.totalSteps - 1;
    tutorial.notifyStepComplete();
    vi.advanceTimersByTime(900);

    expect(tutorial.running).toBe(false);
    expect(tutorial.intro).toBe(false);
    expect(tutorial.state.done).toBe(true);
  });

  it('skip() ends the tutorial and clears every gate', () => {
    const { tutorial, game } = running();
    tutorial.skip();
    expect(tutorial.running).toBe(false);
    expect(tutorial.intro).toBe(false);
    expect(tutorial.satisfied).toBe(false);
    expect(tutorial.state.skipped).toBe(true);
    expect(game.coachHold).toBe(false);
    expect(game.screen).toBe('menu');
  });
});
