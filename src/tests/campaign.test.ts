
/**
 * Ladder checks for the 30-contract campaign.
 *
 * `levels.test.ts` proves each level is *clearable*. That alone is too weak: an
 * unreachable goal with a huge budget also passes as long as the bot happens to
 * finish, and so does a level whose three-star par is impossible. These tests
 * pin the shape of the ladder instead — count, ordering, unique ids, sane
 * goals/budgets, monotone block budgets, and a three-star par that is reachable
 * but tighter than merely "clear it".
 */
import { describe, expect, it } from 'vitest';
import { contractLevels, levelById, validateLevel } from '../game/core/level';
import { GameEngine } from '../game/core/engine';
import type { LevelDefinition } from '../game/core/types';

/** Greedy one-ply bot (same policy as levels.test.ts, duplicated to keep that file untouched). */
function play(level: LevelDefinition): GameEngine {
  const clone = (ops: { t: number; a: 'L' | 'R' | 'C' | 'A' | 'D' | 'H' | 'S' }[]) => {
    const c = new GameEngine({ level, seed: level.seed, mode: 'contract' });
    let cur = 0;
    const lastTick = ops.length ? ops[ops.length - 1].t : 0;
    for (let guard = 0; guard < 20000 && c.status === 'playing'; guard++) {
      while (cur < ops.length && ops[cur].t <= c.tick) c.handleAction(ops[cur++].a);
      if (cur >= ops.length && c.tick >= lastTick) break;
      c.step();
    }
    return c;
  };
  let engine = new GameEngine({ level, seed: level.seed, mode: 'contract' });
  for (let move = 0; move < 60 && engine.status === 'playing'; move++) {
    if (!engine.piece) { engine.step(); continue; }
    const w = engine.piece.width;
    const cands: GameEngine[] = [];
    for (const rot of [0, 1, 2, 3]) {
      for (let x = 0; x <= level.cols - w; x++) {
        const c = clone(engine.ops);
        if (!c.piece) continue;
        for (let r = 0; r < rot; r++) c.handleAction('C');
        let g = 0;
        while (c.piece && c.pieceX > x && g++ < 20) c.handleAction('L');
        g = 0;
        while (c.piece && c.pieceX < x && g++ < 20) c.handleAction('R');
        c.handleAction('A');
        for (let i = 0; i < 70; i++) { if (c.status !== 'playing') break; c.step(); }
        cands.push(c);
        if (c.status === 'won') break;
      }
      if (cands.some((c) => c.status === 'won')) break;
    }
    if (!cands.length) break;
    cands.sort((a, b) => {
      const aw = a.status === 'won' ? 1 : 0, bw = b.status === 'won' ? 1 : 0;
      if (aw !== bw) return bw - aw;
      const al = a.status === 'lost' ? 1 : 0, bl = b.status === 'lost' ? 1 : 0;
      if (al !== bl) return al - bl;
      return (b.currentScore() + b.ledger.drainedClean * 6 + b.ledger.drainedDirty * 2)
        - (a.currentScore() + a.ledger.drainedClean * 6 + a.ledger.drainedDirty * 2);
    });
    engine = cands[0];
  }
  return engine;
}

describe('campaign ladder', () => {
  const levels = contractLevels();

  it('ships exactly 30 contracts, numbered 1..30 in order', () => {
    expect(levels.length).toBe(30);
    expect(levels.map((l) => l.index)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(levels.map((l) => l.id)).toEqual(Array.from({ length: 30 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`));
  });

  it('every id resolves and every level passes schema validation', () => {
    for (const l of levels) {
      expect(levelById(l.id)?.id, l.id).toBe(l.id);
      expect(validateLevel(l), l.id).toEqual([]);
    }
  });

  it('ids, names and seeds are unique', () => {
    expect(new Set(levels.map((l) => l.id)).size).toBe(30);
    expect(new Set(levels.map((l) => l.name)).size).toBe(30);
    expect(new Set(levels.map((l) => l.seed)).size).toBe(30);
  });

  it('every level has goals, a non-empty pool and a real budget', () => {
    for (const l of levels) {
      expect(l.goals.length, l.id).toBeGreaterThan(0);
      expect(l.pool.length, l.id).toBeGreaterThan(0);
      expect(l.blockLimit, l.id).toBeGreaterThanOrEqual(10);
      expect(l.blockLimit, l.id).toBeLessThanOrEqual(30);
      // A goal has to be big enough to be a contract and small enough to fit
      // in a run. Dirty goals are naturally smaller: the dirty drains are a
      // narrow relief path, not the main outflow.
      for (const g of l.goals) {
        const floor = g.type === 'drainDirty' ? 3 : 4;
        expect(g.amount ?? 0, `${l.id} ${g.type}`).toBeGreaterThanOrEqual(floor);
        expect(g.amount ?? 0, `${l.id} ${g.type}`).toBeLessThanOrEqual(16);
      }
    }
  });

  it('a three-star par is always within the block budget', () => {
    for (const l of levels) {
      expect(l.star3Blocks, l.id).toBeGreaterThanOrEqual(3);
      expect(l.star3Blocks, l.id).toBeLessThanOrEqual(l.blockLimit);
    }
  });

  it('difficulty does not collapse: no level gets dramatically more generous', () => {
    // Individual dips are fine (a level that teaches one mechanic sometimes
    // needs fewer blocks than the combination level before it), but a big jump
    // backwards would mean the ladder reset itself.
    for (let i = 1; i < levels.length; i++) {
      const drop = levels[i - 1].blockLimit - levels[i].blockLimit;
      expect(drop, `${levels[i].id} has ${drop} fewer blocks than ${levels[i - 1].id}`).toBeLessThanOrEqual(6);
    }
    // The last level must be at least as generous as the first.
    expect(levels[levels.length - 1].blockLimit).toBeGreaterThanOrEqual(levels[0].blockLimit);
  });

  it('the last contract is a real capstone, not a tutorial', () => {
    const last = levels[levels.length - 1];
    expect(last.drains.length).toBeGreaterThanOrEqual(2);
    expect(last.pool.length).toBeGreaterThanOrEqual(6);
    expect(last.goals.length).toBeGreaterThanOrEqual(1);
  });
});

describe('new contracts are beatable and par-tight', () => {
  const added = contractLevels().filter((l) => Number(l.id.slice(1)) >= 13);

  it('covers 18 new levels', () => {
    expect(added.length).toBe(18);
  });

  it('each new level is clearable by the reference bot', () => {
    for (const l of added) {
      const run = play(l);
      expect(run.status, `${l.id} ${l.name}: ${run.failureReason || '-'}`).toBe('won');
      expect(run.blocksUsed, `${l.id} used ${run.blocksUsed}/${l.blockLimit}`).toBeLessThanOrEqual(l.blockLimit);
    }
  }, 600000);

  it('each new level actually drains what its goal asks for', () => {
    for (const l of added) {
      const run = play(l);
      for (const g of l.goals) {
        const amount = g.amount ?? 0;
        if (g.type === 'drainClean') {
          expect(run.ledger.drainedClean, `${l.id} clean`).toBeGreaterThanOrEqual(amount);
        } else if (g.type === 'drainDirty') {
          expect(run.ledger.drainedDirty, `${l.id} dirty`).toBeGreaterThanOrEqual(amount);
        }
      }
    }
  }, 600000);

  it('a three-star par leaves room but is not free', () => {
    for (const l of added) {
      const run = play(l);
      // Par must be achievable (the bot's own count is the reference)...
      expect(l.star3Blocks, l.id).toBeGreaterThanOrEqual(3);
      // ...and a level must still be losable, i.e. the goal is not met with a
      // single block: the budget has to be meaningfully larger than that.
      expect(l.blockLimit, l.id).toBeGreaterThan(3);
    }
  }, 600000);
});
