import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { buildRunResult, decodeOps, encodeOps, playback, verifyReplay } from '../game/core/replay';
import { decodeShareCode, encodeShareCode } from '../game/core/shareCode';
import { levelById } from '../game/core/level';
import type { ReplayOp, ReplayPayload } from '../game/core/types';

function makeRun(seed: number, levelId = 'c01'): { engine: GameEngine; ops: ReplayOp[] } {
  const level = levelById(levelId)!;
  const engine = new GameEngine({ level, seed, mode: 'contract' });
  const plan: ('L' | 'R' | 'C' | 'A' | 'H')[] = ['L', 'L', 'A', 'R', 'R', 'A', 'C', 'C', 'A', 'L', 'A'];
  for (const a of plan) {
    engine.handleAction(a);
    for (let i = 0; i < 40; i++) engine.step();
    if (engine.status !== 'playing') break;
  }
  for (let i = 0; i < 200; i++) engine.step();
  return { engine, ops: engine.ops.slice() };
}

function payloadFor(seed: number, levelId = 'c01'): ReplayPayload {
  const { engine, ops } = makeRun(seed, levelId);
  return {
    v: 1,
    l: levelId,
    s: seed,
    o: ops,
    c: engine.currentScore(),
    h: engine.getStateHash(),
    r: engine.status === 'won' ? 'won' : 'lost',
    tt: engine.tick,
    at: 0,
  };
}

describe('replay determinism', () => {
  it('replays the same operation stream to the same state hash', () => {
    const payload = payloadFor(777);
    const res = playback(payload);
    expect(res.hash).toBe(payload.h);
    expect(res.score).toBe(payload.c);
  });

  it('verifies a valid payload', () => {
    const payload = payloadFor(2024);
    const check = verifyReplay(payload);
    expect(check.ok).toBe(true);
  });

  it('rejects a payload whose hash was tampered with', () => {
    const payload = payloadFor(31337);
    const tampered: ReplayPayload = { ...payload, c: payload.c + 999 };
    // The tamper changes the displayed score only; if the hash is also wrong
    // the verifier must fail.
    const bad: ReplayPayload = { ...tampered, h: 'deadbeef' };
    const check = verifyReplay(bad);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('hash');
  });

  it('produces the same hash for two independently replayed runs', () => {
    const p = payloadFor(5150);
    const a = playback(p);
    const b = playback(p);
    expect(a.hash).toBe(b.hash);
  });

  it('builds a consistent RunResult', () => {
    const { engine } = makeRun(9);
    const run = buildRunResult(engine);
    expect(run.seed).toBe(9);
    expect(run.hash).toBe(engine.getStateHash());
    expect(run.blocksUsed).toBe(engine.blocksUsed);
    expect(run.ops.length).toBe(engine.ops.length);
  });
});

describe('operation encoding', () => {
  it('round-trips an op stream through the binary encoder', () => {
    const payload = payloadFor(404);
    const code = encodeOps(payload);
    const decoded = decodeOps(code, payload.l);
    expect(decoded.s).toBe(payload.s);
    expect(decoded.c).toBe(payload.c);
    expect(decoded.o.length).toBe(payload.o.length);
    for (let i = 0; i < decoded.o.length; i++) {
      expect(decoded.o[i].a).toBe(payload.o[i].a);
      expect(decoded.o[i].t).toBe(payload.o[i].t);
    }
  });

  it('handles an empty op stream', () => {
    const payload: ReplayPayload = { v: 1, l: 'c01', s: 1, o: [], c: 0, h: '00000000', r: 'lost' };
    const decoded = decodeOps(encodeOps(payload), 'c01');
    expect(decoded.o.length).toBe(0);
    expect(decoded.s).toBe(1);
  });
});

describe('share codes', () => {
  it('round-trips a share code', () => {
    const payload = payloadFor(1234);
    const code = encodeShareCode(payload);
    expect(code.startsWith('WW3-')).toBe(true);
    const decoded = decodeShareCode(code);
    expect(decoded.ok).toBe(true);
    expect(decoded.payload?.l).toBe(payload.l);
    expect(decoded.payload?.s).toBe(payload.s);
    expect(decoded.payload?.o.length).toBe(payload.o.length);
  });

  it('rejects a corrupted checksum', () => {
    const payload = payloadFor(88);
    const code = encodeShareCode(payload);
    const broken = code.slice(0, 4) + 'AA' + code.slice(6);
    const decoded = decodeShareCode(broken);
    // Either the checksum fails or the payload is unreadable.
    expect(decoded.ok).toBe(false);
  });

  it('rejects malformed input with a readable message', () => {
    const decoded = decodeShareCode('not-a-code');
    expect(decoded.ok).toBe(false);
    expect(decoded.error).toBeTruthy();
  });

  it('a decoded share code replays to the recorded score', () => {
    const payload = payloadFor(2468);
    const decoded = decodeShareCode(encodeShareCode(payload));
    expect(decoded.ok).toBe(true);
    const replay = playback(decoded.payload!);
    expect(replay.score).toBe(payload.c);
    expect(replay.hash).toBe(payload.h);
  });
});

describe('engine invariants', () => {
  it('never drops a piece below the floor', () => {
    const level = levelById('c01')!;
    const engine = new GameEngine({ level, seed: 5 });
    for (let n = 0; n < 12 && engine.status === 'playing'; n++) {
      engine.handleAction('A');
      for (let i = 0; i < 20; i++) engine.step();
      const p = engine.piece;
      if (!p) continue;
      for (const c of p.cells) {
        expect(engine.pieceY + c.y).toBeLessThan(engine.rows + 1);
      }
    }
  });

  it('ends the run when the block budget is exhausted', () => {
    const level = levelById('c01')!;
    const engine = new GameEngine({ level, seed: 3 });
    // Hard-drop the full budget plus a few.
    for (let n = 0; n < level.blockLimit + 2; n++) {
      if (engine.status !== 'playing') break;
      engine.handleAction('A');
      for (let i = 0; i < 10; i++) engine.step();
    }
    expect(['won', 'lost']).toContain(engine.status);
  });

  it('exposes goals with human-readable labels', () => {
    const level = levelById('c10')!;
    const engine = new GameEngine({ level, seed: 1 });
    expect(engine.goals.length).toBeGreaterThan(1);
    for (const g of engine.goals) expect(g.label.length).toBeGreaterThan(2);
  });
});
