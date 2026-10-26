import { describe, expect, it } from 'vitest';
import { Bag } from '../game/core/bag';
import { GameEngine } from '../game/core/engine';
import { levelById } from '../game/core/level';
import { replaySolution, solveLevel, upperBound } from '../game/core/solver';

/**
 * The score solver branches by cloning engines instead of replaying the run
 * from tick 0, so the clone has to be bit-exact: same grid, same water, same
 * future piece stream. These tests are the guard rail for that.
 */
describe('engine clone', () => {
  it('bag clone continues the same piece stream', () => {
    const level = levelById('c01')!;
    const a = new Bag(level.pool, 12345, 7);
    a.next();
    a.next();
    const b = a.clone();
    const sa: string[] = [];
    const sb: string[] = [];
    for (let i = 0; i < 30; i++) {
      sa.push(a.next());
      sb.push(b.next());
    }
    expect(sb).toEqual(sa);
  });

  it('engine clone matches the original tick for tick', () => {
    const level = levelById('c05')!;
    const a = new GameEngine({ level, seed: level.seed, mode: 'contract' });
    for (let i = 0; i < 40; i++) a.step();
    a.handleAction('R');
    a.handleAction('A');
    for (let i = 0; i < 40; i++) a.step();
    const b = a.clone();
    expect(b.getStateHash()).toBe(a.getStateHash());

    const actions = ['L', 'R', 'C', 'D', 'A'] as const;
    let seed = 99;
    for (let i = 0; i < 200 && a.status === 'playing'; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const act = actions[seed % actions.length];
      a.handleAction(act);
      b.handleAction(act);
      a.step();
      b.step();
      expect(b.getStateHash(), `tick ${i}`).toBe(a.getStateHash());
      expect(b.ops.length, `ops at ${i}`).toBe(a.ops.length);
    }
  });
});

describe('max score solver', () => {
  it('solves c01 and the ops replay to the same score', () => {
    const level = levelById('c01')!;
    const r = solveLevel(level, { beamWidths: [8, 24], timeBudgetMs: 6000, settleTicks: 80 });
    expect(r.status).toBe('won');
    expect(r.ops.length).toBeGreaterThan(0);
    const done = replaySolution(level, r.ops);
    expect(done.status).toBe('won');
    expect(done.score).toBe(r.score);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(upperBound(level));
  }, 90000);

  it('uses hold to reach the 150 that pure placement cannot', () => {
    // Level 1 hands out soil2, pocket, soil2, soil2, sponge, pocket, pocket.
    // Without hold the third pocket is block 7 (score 135). Holding the first
    // soil2 delivers it at block 6 -> 90 + 15 * 4 = 150. Placements alone can
    // never explain the 150 a player reports, so this test locks hold in.
    const level = levelById('c01')!;
    const r = solveLevel(level, { beamWidths: [12], timeBudgetMs: 8000, humanOnly: true });
    expect(r.status).toBe('won');
    expect(r.score).toBeGreaterThanOrEqual(150);
    expect(r.blocksUsed).toBeLessThanOrEqual(6);
    expect(r.ops.some((o) => o.a === 'H')).toBe(true);
  }, 90000);

  it('the search beats using every block', () => {
    const level = levelById('c01')!;
    const r = solveLevel(level, { beamWidths: [16], timeBudgetMs: 6000, settleTicks: 80 });
    expect(r.blocksUsed).toBeLessThanOrEqual(level.blockLimit);
    expect(r.score).toBeGreaterThan(100);
  }, 90000);
});
