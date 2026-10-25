import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from '../stores/gameStore';
import { useTutorialStore } from '../stores/tutorialStore';
import type { RunResult } from '../game/core/types';

/**
 * Regression guards for "the last block is placed and the game just sits there".
 *
 * lockPiece() ends the run when the block budget is spent, and it runs inside
 * handleAction('A') - i.e. inside store.dispatch, not inside stepOnce. The
 * store used to publish the HUD snapshot and then return, so the loop stopped
 * advancing (status !== 'playing') while no result card was ever shown.
 */
describe('a run that ends inside an action', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function lose() {
    const store = useGameStore();
    store.startLevel('c01');
    const engine = store.engine!;
    // One block of budget: the first hard drop spends it and lockPiece()
    // declares the loss while the goals are still unmet.
    engine.blockLimit = 1;
    store.dispatch('A');
    return { store, engine };
  }

  it('shows the result card when the last block is hard-dropped', () => {
    const { store, engine } = lose();
    expect(engine.blocksUsed).toBe(1);
    expect(engine.status).toBe('lost');
    expect(store.result?.won).toBe(false);
    expect(store.result?.reason).toBeTruthy();
    expect(store.showResult).toBe(true);
  });

  it('hands the verdict over exactly once', () => {
    const { store } = lose();
    const first = store.result;
    expect(first).toBeTruthy();
    // Further input on a finished run must not rebuild the result or reopen a card.
    store.dispatch('A');
    store.dispatch('L');
    expect(store.result).toBe(first);
    expect(store.showResult).toBe(true);
  });

  it('stays terminal on later ticks', () => {
    const { store, engine } = lose();
    store.stepOnce();
    expect(engine.status).toBe('lost');
    expect(store.showResult).toBe(true);
  });
});

describe('failure presentation for coached tutorial steps', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps the coaching flag when a step is retried', () => {
    const store = useGameStore();
    store.startLevel('t01', { coached: true });
    expect(store.suppressWinPresentation).toBe(true);
    store.restart();
    expect(store.suppressWinPresentation).toBe(true);
  });

  it('does not tick a step complete when the run was lost', async () => {
    const tutorial = useTutorialStore();
    const game = useGameStore();
    tutorial.startTutorial();
    tutorial.begin();
    tutorial.dismiss();

    game.result = { won: false, reason: 'block' } as unknown as RunResult;
    game.showResult = true;
    await nextTick();
    expect(tutorial.satisfied).toBe(false);

    game.result = { won: true, reason: 'contract' } as unknown as RunResult;
    game.showResult = false;
    await nextTick();
    game.showResult = true;
    await nextTick();
    expect(tutorial.satisfied).toBe(true);

    // Drop the auto-advance timer this completion just armed.
    tutorial.reset();
  });
});
