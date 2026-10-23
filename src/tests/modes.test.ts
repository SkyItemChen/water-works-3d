import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { dailyLevel } from '../game/core/daily';
import { endlessLevel } from '../game/core/level';
import type { GameMode, LevelDefinition, ReplayOp } from '../game/core/types';

/**
 * A determinism-preserving bot used to guarantee that daily challenges and the
 * endless mode are actually playable, not just generated.
 */

function cloneTo(level: LevelDefinition, seed: number, ops: ReplayOp[], tick: number, mode: GameMode): GameEngine {
  const e = new GameEngine({ level, seed, mode });
  let cur = 0;
  const lastTick = ops.length ? ops[ops.length - 1].t : 0;
  for (let g = 0; g < 30000 && e.status === 'playing'; g++) {
    while (cur < ops.length && ops[cur].t <= e.tick) e.handleAction(ops[cur++].a);
    if (cur >= ops.length && e.tick >= Math.max(lastTick, tick)) break;
    e.step();
  }
  return e;
}

function playGreedy(level: LevelDefinition, maxMoves: number, mode: GameMode = 'contract'): GameEngine {
  let engine = new GameEngine({ level, seed: level.seed, mode });
  for (let move = 0; move < maxMoves && engine.status === 'playing'; move++) {
    if (!engine.piece) {
      engine.step();
      continue;
    }
    const width = engine.piece.width;
    const candidates: GameEngine[] = [];
    for (let rot = 0; rot < 4; rot++) {
      for (let x = 0; x <= level.cols - width; x++) {
        const c = cloneTo(level, level.seed, engine.ops, engine.tick, mode);
        if (!c.piece) continue;
        for (let r = 0; r < rot; r++) c.handleAction('C');
        let guard = 0;
        while (c.piece && c.pieceX > x && guard++ < 20) c.handleAction('L');
        guard = 0;
        while (c.piece && c.pieceX < x && guard++ < 20) c.handleAction('R');
        c.handleAction('A');
        for (let i = 0; i < 70; i++) {
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
      return b.currentScore() + b.ledger.drainedClean * 6 - (a.currentScore() + a.ledger.drainedClean * 6);
    });
    engine = candidates[0];
  }
  return engine;
}

describe('daily and endless playability', () => {
  it('daily challenges are seeded, dry, and at least most days are winnable', () => {
    const days = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];
    let wins = 0;
    for (const day of days) {
      const level = dailyLevel(day);
      expect(level.id).toBe('daily');
      // Same date always builds the same level.
      expect(dailyLevel(day).seed).toBe(level.seed);
      expect(level.initialWater ?? []).toEqual([]);
      const res = playGreedy(level, 20, 'daily');
      if (res.status === 'won') wins++;
    }
    expect(wins, `only ${wins}/${days.length} daily runs were winnable`).toBeGreaterThanOrEqual(3);
  }, 120000);

  it('endless mode runs past the first ten pieces without a hard stop', () => {
    const level = endlessLevel(1234);
    expect(level.endless).toBe(true);
    const res = playGreedy(level, 20, 'endless');
    expect(res.blocksUsed).toBeGreaterThanOrEqual(10);
  }, 120000);
});
