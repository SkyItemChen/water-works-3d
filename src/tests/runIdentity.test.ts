import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useGameStore } from '../stores/gameStore';

/**
 * Regression guard for "click 再打一次 and the camera stays pulled back".
 *
 * `restart()` reuses the same level object, so `level.id` never changes and a
 * watcher keyed on it never fires. The canvas therefore needs a per-run
 * identity — `runId` — to know it must restore the default camera framing.
 */
describe('run identity', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('bumps runId on restart even though the level is unchanged', () => {
    const store = useGameStore();
    store.startLevel('c01');
    const levelRef = store.level;
    const first = store.runId;

    store.restart();

    expect(store.runId).toBeGreaterThan(first);
    // Same object, same id: only runId can distinguish the retry.
    expect(store.level).toBe(levelRef);
    expect(store.level?.id).toBe('c01');
  });

  it('bumps runId for every entry point', () => {
    const store = useGameStore();
    const seen = new Set<number>();
    store.startLevel('c01');
    seen.add(store.runId);
    store.startIndex(2);
    seen.add(store.runId);
    store.startDaily('2026-10-23');
    seen.add(store.runId);
    store.startEndless();
    seen.add(store.runId);
    expect(seen.size).toBe(4);
    expect([...seen].every((v) => v > 0)).toBe(true);
  });

  it('clears the win presentation flags a retry inherits', () => {
    const store = useGameStore();
    store.startLevel('c01');
    store.draining = true;
    store.showResult = true;
    store.restart();
    expect(store.draining).toBe(false);
    expect(store.showResult).toBe(false);
  });
});
