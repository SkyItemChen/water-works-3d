import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { isTutorialLevelId, levelById, tutorialLevels } from '../game/core/level';
import { decodeStoredProgress } from '../game/core/saveFile';
import {
  advanceTutorial,
  buildObservation,
  createTutorialState,
  currentStep,
  emptyObservation,
  evaluateCondition,
  forceAdvance,
  progressLabel,
  skipTutorial,
  type TutorialSnapshotLike,
} from '../game/core/tutorial';
import type { TutorialStepData } from '../game/core/types';

/**
 * Tutorial tests.
 *
 * Two things are being protected here:
 *  1. the state machine itself (predicates, skip, forced advance), and
 *  2. the architecture guarantee — attaching the tutorial must not perturb the
 *     deterministic run by a single bit of state hash.
 */

function steps(): TutorialStepData[] {
  return tutorialLevels()
    .map((l) => l.tutorial)
    .filter((s): s is TutorialStepData => !!s);
}

describe('tutorial data', () => {
  it('ships five steps with stable ids, in order', () => {
    const list = steps();
    expect(list.map((s) => s.stepId)).toEqual(['t01', 't02', 't03', 't04', 't05']);
  });

  it('every step has goal text, a condition and a highlight', () => {
    for (const s of steps()) {
      expect(s.goalText.length).toBeGreaterThan(0);
      expect(s.condition).toBeTruthy();
      const h = s.highlight;
      const hasTarget = (h.columns?.length ?? 0) + (h.cells?.length ?? 0) + (h.hud?.length ?? 0) > 0;
      expect(hasTarget, `${s.stepId} has no highlight target`).toBe(true);
    }
  });

  it('tutorial levels are separate from the contract catalogue', () => {
    for (const l of tutorialLevels()) {
      expect(isTutorialLevelId(l.id)).toBe(true);
      expect(levelById(l.id)?.id).toBe(l.id);
    }
  });
});

describe('tutorial predicates', () => {
  it('lockKind only fires for the listed kinds', () => {
    const cond = { kind: 'lockKind' as const, anyOf: ['soil2', 'soilL'] as const };
    expect(evaluateCondition(cond, { ...emptyObservation(), lockKind: 'soil2' })).toBe(true);
    expect(evaluateCondition(cond, { ...emptyObservation(), lockKind: 'soilL' })).toBe(true);
    expect(evaluateCondition(cond, { ...emptyObservation(), lockKind: 'pocket' })).toBe(false);
    expect(evaluateCondition(cond, emptyObservation())).toBe(false);
  });

  it('drain thresholds require the exact amount', () => {
    const clean = { kind: 'drainedCleanAtLeast' as const, amount: 1 };
    expect(evaluateCondition(clean, { ...emptyObservation(), drainedClean: 0.9 })).toBe(false);
    expect(evaluateCondition(clean, { ...emptyObservation(), drainedClean: 1 })).toBe(true);

    const dirty = { kind: 'drainedDirtyAtLeast' as const, amount: 1 };
    expect(evaluateCondition(dirty, { ...emptyObservation(), drainedDirty: 0.5 })).toBe(false);
    expect(evaluateCondition(dirty, { ...emptyObservation(), drainedDirty: 2 })).toBe(true);
  });

  it('mixed requires the mix flag', () => {
    const cond = { kind: 'mixed' as const };
    expect(evaluateCondition(cond, { ...emptyObservation(), mixed: true })).toBe(true);
    expect(evaluateCondition(cond, emptyObservation())).toBe(false);
  });

  it('all() requires every child predicate', () => {
    const cond = {
      kind: 'all' as const,
      of: [
        { kind: 'lockKind' as const, anyOf: ['pocket'] as const },
        { kind: 'drainedCleanAtLeast' as const, amount: 1 },
      ],
    };
    expect(evaluateCondition(cond, { ...emptyObservation(), lockKind: 'pocket', drainedClean: 1 })).toBe(true);
    expect(evaluateCondition(cond, { ...emptyObservation(), lockKind: 'pocket' })).toBe(false);
    expect(evaluateCondition(cond, { ...emptyObservation(), drainedClean: 5 })).toBe(false);
  });
});

describe('tutorial state machine', () => {
  it('advances only on a matching event', () => {
    const list = steps();
    const start = createTutorialState(list);
    expect(currentStep(list, start)?.stepId).toBe('t01');

    // Wrong event: nothing moves.
    const wrong = advanceTutorial(list, start, { ...emptyObservation(), lockKind: 'pocket' });
    expect(wrong).toBe(start);
    expect(wrong.stepIndex).toBe(0);

    // Right event: step 1 is satisfied.
    const right = advanceTutorial(list, start, { ...emptyObservation(), lockKind: 'soil2' });
    expect(right.stepIndex).toBe(1);
    expect(currentStep(list, right)?.stepId).toBe('t02');
  });

  it('each step reacts to its own predicate and ignores the others', () => {
    const list = steps();
    // Step 2 wants a clean pocket lock; a drain event must not satisfy it.
    const s2 = { stepIndex: 1, totalSteps: list.length, done: false, skipped: false };
    expect(advanceTutorial(list, s2, { ...emptyObservation(), drainedClean: 10 })).toBe(s2);
    expect(advanceTutorial(list, s2, { ...emptyObservation(), lockKind: 'pocket' }).stepIndex).toBe(2);

    // Step 3 wants real drainage, not a lock.
    const s3 = { stepIndex: 2, totalSteps: list.length, done: false, skipped: false };
    expect(advanceTutorial(list, s3, { ...emptyObservation(), lockKind: 'pocket' })).toBe(s3);
    expect(advanceTutorial(list, s3, { ...emptyObservation(), drainedClean: 1 }).stepIndex).toBe(3);

    // Step 4 wants dirty drainage.
    const s4 = { stepIndex: 3, totalSteps: list.length, done: false, skipped: false };
    expect(advanceTutorial(list, s4, { ...emptyObservation(), drainedClean: 99 })).toBe(s4);
    expect(advanceTutorial(list, s4, { ...emptyObservation(), drainedDirty: 1 }).stepIndex).toBe(4);

    // Step 5 wants a pipe or sponge.
    const s5 = { stepIndex: 4, totalSteps: list.length, done: false, skipped: false };
    expect(advanceTutorial(list, s5, { ...emptyObservation(), lockKind: 'soil2' })).toBe(s5);
    const done = advanceTutorial(list, s5, { ...emptyObservation(), lockKind: 'pipe' });
    expect(done.done).toBe(true);
  });

  it('finishing the last step marks the tutorial done', () => {
    const list = steps();
    const last = { stepIndex: list.length - 1, totalSteps: list.length, done: false, skipped: false };
    const after = advanceTutorial(list, last, { ...emptyObservation(), lockKind: 'sponge' });
    expect(after.done).toBe(true);
    expect(after.skipped).toBe(false);
    expect(currentStep(list, after)).toBeNull();
  });

  it('forceAdvance walks the pointer without needing an event', () => {
    const list = steps();
    let state = createTutorialState(list);
    for (let i = 1; i < list.length; i++) {
      state = forceAdvance(list, state);
      expect(state.stepIndex).toBe(i);
      expect(state.done).toBe(false);
    }
    state = forceAdvance(list, state);
    expect(state.done).toBe(true);
  });

  it('skip finishes immediately from any step and reports skipped', () => {
    const list = steps();
    for (const index of [0, 2, list.length - 1]) {
      const state = { stepIndex: index, totalSteps: list.length, done: false, skipped: false };
      const skipped = skipTutorial(list, state);
      expect(skipped.done).toBe(true);
      expect(skipped.skipped).toBe(true);
      expect(skipped.stepIndex).toBe(list.length);
    }
  });

  it('reports a stable progress label', () => {
    const list = steps();
    expect(progressLabel(createTutorialState(list))).toBe(`1/${list.length}`);
    const mid = { stepIndex: 2, totalSteps: list.length, done: false, skipped: false };
    expect(progressLabel(mid)).toBe(`3/${list.length}`);
  });
});

describe('tutorial observation building', () => {
  const snap = (blocksUsed: number, kind: 'soil2' | 'pocket' | null, clean = 0): TutorialSnapshotLike => ({
    blocksUsed,
    piece: kind ? { kind } : null,
    ledger: { drainedClean: clean, drainedDirty: 0 },
    mixCells: [],
  });

  it('detects a lock only when the block counter moved', () => {
    const prev = snap(3, 'pocket');
    const next = snap(4, 'soil2');
    expect(buildObservation(prev, next, 'pocket').lockKind).toBe('pocket');
    expect(buildObservation(prev, prev, 'pocket').lockKind).toBeNull();
  });

  it('passes drain counters straight through', () => {
    const obs = buildObservation(snap(0, 'soil2'), snap(0, 'soil2', 3.5), 'soil2');
    expect(obs.drainedClean).toBe(3.5);
  });
});

describe('regression: the tutorial never perturbs a run', () => {
  /** Play a scripted sequence and return the final state hash. */
  function play(levelId: string, withTutorialObserver: boolean): string {
    const level = levelById(levelId)!;
    const e = new GameEngine({ level, seed: level.seed, mode: 'contract' });
    const list = steps();
    let state = createTutorialState(list);
    let prev: TutorialSnapshotLike | null = null;
    let prevKind: null | 'soil2' = null;

    const record = (): void => {
      if (!withTutorialObserver) return;
      const next: TutorialSnapshotLike = {
        blocksUsed: e.blocksUsed,
        piece: e.piece ? { kind: e.piece.kind } : null,
        ledger: { drainedClean: e.ledger.drainedClean, drainedDirty: e.ledger.drainedDirty },
        mixCells: e.view().mixture,
      };
      if (prev) {
        state = advanceTutorial(list, state, buildObservation(prev, next, prevKind));
      }
      prev = next;
      prevKind = (e.piece?.kind ?? prevKind) as null | 'soil2';
    };

    record();
    for (let i = 0; i < 240 && e.status === 'playing'; i++) {
      if (e.piece) {
        // Vary the moves so pieces actually land and water actually flows.
        if (i % 3 === 0) e.handleAction('L');
        if (i % 5 === 0) e.handleAction('C');
        if (i % 4 === 0) e.handleAction('A');
      }
      e.step();
      record();
    }
    void state;
    return e.getStateHash();
  }

  it('same (level, seed, ops) gives a bit-identical hash with and without the tutorial', () => {
    for (const id of ['c01', 'c03', 'c07']) {
      const plain = play(id, false);
      const observed = play(id, true);
      expect(observed, `hash diverged for ${id}`).toBe(plain);
    }
  });

  it('the tutorial state does not appear in the engine snapshot surface', () => {
    const level = levelById('t01')!;
    const e = new GameEngine({ level, seed: level.seed, mode: 'contract' });
    const keys = Object.keys(e.view());
    for (const k of keys) {
      expect(k.toLowerCase()).not.toContain('tutorial');
    }
  });
});

describe('tutorial persistence', () => {
  /** Minimal localStorage stand-in; node env has none. */
  function installStorage(seed: Record<string, string> = {}): Record<string, string> {
    const store: Record<string, string> = { ...seed };
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    };
    return store;
  }

  it('an old save without tutorialDone loads and reads as not done', async () => {
    installStorage({
      'waterworks3d.progress.v1': JSON.stringify({
        levels: { c01: { stars: 3, bestScore: 120, bestBlocks: 4, cleared: true, attempts: 1, lastPlayed: 1 } },
        daily: {},
        shareHistory: [],
        endlessBest: 40,
        totalRuns: 1,
        totalScore: 120,
      }),
    });
    const { createPinia, setActivePinia } = await import('pinia');
    setActivePinia(createPinia());
    const { useProgressStore } = await import('../stores/progressStore');
    const p = useProgressStore();
    expect(p.data.levels.c01.stars).toBe(3);
    expect(p.data.endlessBest).toBe(40);
    expect(p.tutorialDone).toBe(false);
    expect(p.tutorialIsNew).toBe(true);
  });

  it('marking the tutorial done persists and clears the "new" badge', async () => {
    const store = installStorage();
    const { createPinia, setActivePinia } = await import('pinia');
    const pinia = createPinia();
    setActivePinia(pinia);
    const { useProgressStore } = await import('../stores/progressStore');
    const p = useProgressStore();
    expect(p.tutorialIsNew).toBe(true);
    p.markTutorialDone();
    await Promise.resolve();
    expect(p.tutorialDone).toBe(true);
    expect(p.tutorialIsNew).toBe(false);
    const raw = store['waterworks3d.progress.v1'];
    expect(raw).toBeTruthy();
    // Stored value is the compact save text (arrays + base64), not JSON any more.
    expect(raw.startsWith('WWSAVE1:')).toBe(true);
    expect(decodeStoredProgress(raw)?.progress.tutorialDone).toBe(true);
  });

  it('the skip path marks the tutorial done', async () => {
    const store = installStorage();
    const { createPinia, setActivePinia } = await import('pinia');
    setActivePinia(createPinia());
    const { skipTutorial } = await import('../game/core/tutorial');
    const list = steps();
    // The store calls skipTutorial(); assert the resulting state is "done+skipped"
    // and that persisting that outcome is what clears the badge.
    const skipped = skipTutorial(list, createTutorialState(list));
    expect(skipped.done).toBe(true);
    expect(skipped.skipped).toBe(true);

    const { useProgressStore } = await import('../stores/progressStore');
    const p = useProgressStore();
    p.markTutorialDone();
    await Promise.resolve();
    expect(p.tutorialDone).toBe(true);
    expect(decodeStoredProgress(store['waterworks3d.progress.v1'])?.progress.tutorialDone).toBe(true);
  });
});

describe('tutorial level solvability', () => {
  /** Deterministic one-ply greedy bot, same shape as levels.test.ts. */
  function playGreedy(levelId: string): { status: string; blocks: number } {
    const level = levelById(levelId)!;
    const seed = level.seed;
    let engine = new GameEngine({ level, seed, mode: 'contract' });
    for (let move = 0; move < 40 && engine.status === 'playing'; move++) {
      if (!engine.piece) {
        engine.step();
        continue;
      }
      const pieceW = engine.piece.width;
      const candidates: GameEngine[] = [];
      for (const rot of [0, 1, 2, 3]) {
        for (let x = 0; x <= level.cols - pieceW; x++) {
          const c = new GameEngine({ level, seed, mode: 'contract' });
          // Replay the ops so far.
          let cur = 0;
          const ops = engine.ops;
          const lastTick = ops.length ? ops[ops.length - 1].t : 0;
          for (let guard = 0; guard < 20000 && c.status === 'playing'; guard++) {
            while (cur < ops.length && ops[cur].t <= c.tick) c.handleAction(ops[cur++].a);
            if (cur >= ops.length && c.tick >= lastTick) break;
            c.step();
          }
          if (!c.piece) continue;
          for (let r = 0; r < rot; r++) c.handleAction('C');
          let guard = 0;
          while (c.piece && c.pieceX > x && guard++ < 20) c.handleAction('L');
          guard = 0;
          while (c.piece && c.pieceX < x && guard++ < 20) c.handleAction('R');
          c.handleAction('A');
          for (let i = 0; i < 80; i++) {
            if (c.status !== 'playing') break;
            c.step();
          }
          candidates.push(c);
          if (c.status === 'won') break;
        }
        if (candidates.some((c) => c.status === 'won')) break;
      }
      if (!candidates.length) break;
      candidates.sort((a, b) => {
        const aw = a.status === 'won' ? 1 : 0;
        const bw = b.status === 'won' ? 1 : 0;
        if (aw !== bw) return bw - aw;
        const al = a.status === 'lost' ? 1 : 0;
        const bl = b.status === 'lost' ? 1 : 0;
        if (al !== bl) return al - bl;
        return (
          b.currentScore() +
          b.ledger.drainedClean * 6 +
          b.ledger.drainedDirty * 2 -
          (a.currentScore() + a.ledger.drainedClean * 6 + a.ledger.drainedDirty * 2)
        );
      });
      engine = candidates[0];
    }
    return { status: engine.status, blocks: engine.blocksUsed };
  }

  it('every tutorial level is clearable by the greedy bot within its budget', () => {
    for (const level of tutorialLevels()) {
      const r = playGreedy(level.id);
      expect(r.status, `${level.id} ${level.name}`).toBe('won');
      expect(r.blocks, `${level.id} used ${r.blocks}/${level.blockLimit}`).toBeLessThanOrEqual(level.blockLimit);
    }
  }, 300000);
});
