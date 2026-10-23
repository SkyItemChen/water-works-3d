import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { contractLevels, levelById } from '../game/core/level';
import type { ReplayOp } from '../game/core/types';

/**
 * Solvability guard.
 *
 * A deterministic one-ply greedy bot plays every contract level. It is far
 * weaker than a human, so if it can clear a level the level is definitely not
 * a dead end. The bot also exercises the whole stack: pieces, water, goals and
 * failure conditions.
 */

function cloneEngine(levelId: string, seed: number, ops: ReplayOp[]): GameEngine {
  const level = levelById(levelId)!;
  const e = new GameEngine({ level, seed, mode: 'contract' });
  let cur = 0;
  const lastTick = ops.length ? ops[ops.length - 1].t : 0;
  for (let guard = 0; guard < 20000 && e.status === 'playing'; guard++) {
    while (cur < ops.length && ops[cur].t <= e.tick) {
      e.handleAction(ops[cur++].a);
    }
    if (cur >= ops.length && e.tick >= lastTick) break;
    e.step();
  }
  return e;
}

export interface BotResult {
  status: string;
  score: number;
  blocks: number;
  clean: number;
  dirty: number;
  pollution: number;
  reason: string;
}

export function playGreedy(levelId: string): BotResult {
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
        const c = cloneEngine(levelId, seed, engine.ops);
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
      const aScore = a.currentScore() + a.ledger.drainedClean * 6 + a.ledger.drainedDirty * 2;
      const bScore = b.currentScore() + b.ledger.drainedClean * 6 + b.ledger.drainedDirty * 2;
      return bScore - aScore;
    });
    engine = candidates[0];
  }
  return {
    status: engine.status,
    score: engine.score,
    blocks: engine.blocksUsed,
    clean: engine.ledger.drainedClean,
    dirty: engine.ledger.drainedDirty,
    pollution: engine.ledger.pollution,
    reason: engine.failureReason,
  };
}

describe('level solvability', () => {
  it('every contract level can be cleared by a simple greedy player', () => {
    const results = contractLevels().map((l) => ({ level: l, result: playGreedy(l.id) }));
    for (const { level, result } of results) {
      expect(
        result.status,
        `${level.id} ${level.name}: ${result.reason} (clean ${result.clean.toFixed(1)}, dirty ${result.dirty.toFixed(1)})`,
      ).toBe('won');
    }
  }, 300000);

  it('the greedy player stays within the block budget', () => {
    for (const level of contractLevels()) {
      const r = playGreedy(level.id);
      expect(r.blocks, `${level.id} used ${r.blocks}/${level.blockLimit}`).toBeLessThanOrEqual(level.blockLimit);
    }
  }, 300000);
});
