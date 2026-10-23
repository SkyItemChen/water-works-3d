import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { playback, verifyReplay } from '../game/core/replay';
import { decodeShareCode, encodeShareCode } from '../game/core/shareCode';
import { levelById } from '../game/core/level';
import type { ReplayPayload } from '../game/core/types';

function winC01(seed = 11001): GameEngine {
  const level = levelById('c01')!;
  const e = new GameEngine({ level, seed, mode: 'contract' });
  let guard = 0;
  while (e.status === 'playing' && guard++ < 60) {
    if (!e.piece) {
      e.step();
      continue;
    }
    const isPocket = e.piece.kind.startsWith('pocket');
    const target = isPocket ? 4 : 0;
    let g = 0;
    while (e.piece && e.pieceX > target && g++ < 12) e.handleAction('L');
    while (e.piece && e.pieceX < target && g++ < 12) e.handleAction('R');
    e.handleAction('A');
    for (let i = 0; i < 70 && e.status === 'playing'; i++) e.step();
  }
  return e;
}

describe('compact share codes', () => {
  it('produces a short code and replays the clear', () => {
    const e = winC01();
    expect(e.status).toBe('won');
    const payload: ReplayPayload = {
      v: 1, l: 'c01', s: e.seed, o: [], pl: e.placements.slice(),
      c: e.currentScore(), h: e.getStateHash(), r: 'won', tt: e.tick, at: 0,
    };
    const code = encodeShareCode(payload);
    expect(code.length).toBeLessThan(80);
    const decoded = decodeShareCode(code);
    expect(decoded.ok).toBe(true);
    const res = playback(decoded.payload!);
    expect(res.hash).toBe(payload.h);
    expect(res.score).toBe(payload.c);
  });

  it('verifies the compact replay hash', () => {
    const e = winC01(4242);
    const payload: ReplayPayload = {
      v: 1, l: 'c01', s: e.seed, o: [], pl: e.placements.slice(),
      c: e.currentScore(), h: e.getStateHash(), r: 'won', tt: e.tick, at: 0,
    };
    expect(verifyReplay(payload).ok).toBe(true);
  });
});
