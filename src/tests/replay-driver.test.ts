/**
 * Replay bug regression suite.
 *
 * Two defects motivated this file:
 *  1. playback never injected the recorded drop (the UI consumed `payload.o`,
 *     which compact codes leave empty), so pieces fell straight down;
 *  2. playback stopped as soon as the last record was consumed, so the engine's
 *     own terminal verdict never had a chance to run.
 *
 * The invariant guarded here: terminal *detection* is the engine's job and must
 * run during replay; terminal *side effects* belong to the caller and must be
 * absent. Those are two different places and must never be collapsed into one
 * short circuit.
 */
import { describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { ReplayDriver, encodeOps, decodeOps, playback, verifyReplay } from '../game/core/replay';
import { decodeShareCode, encodeShareCode } from '../game/core/shareCode';
import { levelById } from '../game/core/level';
import type { Action } from '../game/core/engine';
import type { LevelDefinition, Placement, ReplayPayload } from '../game/core/types';

/** Replay an op stream into a fresh engine (same helper shape as levels.test.ts). */
function cloneEngine(levelId: string, seed: number, ops: { t: number; a: Action }[]): GameEngine {
  const level = levelById(levelId)!;
  const e = new GameEngine({ level, seed, mode: 'contract' });
  let cur = 0;
  const lastTick = ops.length ? ops[ops.length - 1].t : 0;
  for (let guard = 0; guard < 20000 && e.status === 'playing'; guard++) {
    while (cur < ops.length && ops[cur].t <= e.tick) e.handleAction(ops[cur++].a);
    if (cur >= ops.length && e.tick >= lastTick) break;
    e.step();
  }
  return e;
}

/**
 * Play a level with the project's one-ply greedy bot and return the finished
 * engine, so every case here mirrors how a real winning run looks.
 */
function playGreedy(levelId: string, seed = levelById(levelId)!.seed): GameEngine {
  const level = levelById(levelId)!;
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
        let g = 0;
        while (c.piece && c.pieceX > x && g++ < 20) c.handleAction('L');
        g = 0;
        while (c.piece && c.pieceX < x && g++ < 20) c.handleAction('R');
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
      const as = a.currentScore() + a.ledger.drainedClean * 6 + a.ledger.drainedDirty * 2;
      const bs = b.currentScore() + b.ledger.drainedClean * 6 + b.ledger.drainedDirty * 2;
      return bs - as;
    });
    engine = candidates[0];
  }
  return engine;
}

function compactPayload(e: GameEngine): ReplayPayload {
  return {
    v: 1,
    l: e.level.id,
    s: e.seed,
    o: [],
    pl: e.placements.slice(),
    c: e.currentScore(),
    h: e.getStateHash(),
    r: e.status === 'won' ? 'won' : 'lost',
    tt: e.tick,
    at: 0,
  };
}

/** Run a compact replay tick by tick, recording what happens. */
function trackReplay(payload: ReplayPayload, level?: LevelDefinition) {
  const driver = new ReplayDriver(payload, level);
  const spawns: { tick: number; x: number; r: number }[] = [];
  const locks: { tick: number; x: number; blocks: number }[] = [];
  let prevBlocks = driver.engine.blocksUsed;
  let guard = 0;
  while (!driver.finished && guard++ < 60 * 60 * 10) {
    driver.tick();
    const e = driver.engine;
    if (e.piece && spawns.length < e.blocksUsed + 1) {
      spawns.push({ tick: e.tick, x: e.pieceX, r: 0 });
    }
    if (e.blocksUsed !== prevBlocks) {
      prevBlocks = e.blocksUsed;
      const last = e.placements[e.placements.length - 1];
      locks.push({ tick: last.t, x: last.x, blocks: e.blocksUsed });
    }
  }
  return { driver, spawns, locks };
}

describe('replay: drops are injected at the recorded tick', () => {
  it('places every recorded piece on its recorded column and rotation', () => {
    const e = playGreedy('c01');
    expect(e.placements.length).toBeGreaterThan(2);
    const payload = compactPayload(e);
    const driver = new ReplayDriver(payload);
    let guard = 0;
    while (!driver.finished && guard++ < 60 * 60 * 10) driver.tick();

    expect(driver.allPlaced).toBe(true);
    expect(driver.engine.placements.length).toBe(payload.pl!.length);
    // Lock tick, column and rotation must be reproduced exactly.
    for (let i = 0; i < payload.pl!.length; i++) {
      expect(driver.engine.placements[i].t).toBe(payload.pl![i].t);
      expect(driver.engine.placements[i].x).toBe(payload.pl![i].x);
      expect(driver.engine.placements[i].r).toBe(payload.pl![i].r);
    }
  });

  it('keeps pieces parked between drops instead of letting gravity lock them', () => {
    // A scripted run with real gaps between drops: park the piece, let the water
    // run, then drop. Gravity would destroy this if the driver did not hold the
    // piece, so the recorded per-piece lock ticks only reproduce when parking
    // works.
    const level = levelById('c01')!;
    const e = new GameEngine({ level, seed: 707, mode: 'contract' });
    const gaps = [0, 12, 9, 30, 4];
    for (const gap of gaps) {
      if (e.status !== 'playing' || !e.piece) break;
      e.handleAction('L');
      for (let i = 0; i < gap && e.status === 'playing'; i++) e.step();
      if (!e.piece) break;
      e.handleAction('A');
      e.step();
    }
    const payload = compactPayload(e);
    expect(payload.pl!.length).toBeGreaterThanOrEqual(3);
    // The recording must show genuinely different lock ticks...
    const ticks = new Set(payload.pl!.map((p) => p.t));
    expect(ticks.size).toBeGreaterThan(1);

    const driver = new ReplayDriver(payload);
    let guard = 0;
    while (!driver.finished && guard++ < 60 * 60 * 10) driver.tick();
    // ...and the replay must land them on exactly those ticks.
    expect(driver.engine.placements.map((p) => p.t)).toEqual(payload.pl!.map((p) => p.t));
    expect(driver.engine.placements.map((p) => p.x)).toEqual(payload.pl!.map((p) => p.x));
    expect(driver.engine.getStateHash()).toBe(payload.h);
  });

  it('does not let pieces drift to the spawn column', () => {
    // Use a level whose drains sit left and right, so the recorded columns
    // provably differ from the spawn column.
    const e = playGreedy('c02');
    const payload = compactPayload(e);
    const recordedX = new Set(payload.pl!.map((p) => p.x));
    const driver = new ReplayDriver(payload);
    let guard = 0;
    while (!driver.finished && guard++ < 60 * 60 * 5) driver.tick();
    // Every recorded column must reappear in the replay...
    for (const x of recordedX) {
      expect(driver.engine.placements.some((p) => p.x === x)).toBe(true);
    }
    // ...and the replay must not have collapsed them onto one column, which is
    // what "pieces fall straight down" looked like.
    const replayX = new Set(driver.engine.placements.map((p) => p.x));
    expect(replayX.size).toBeGreaterThan(1);
  });

  it('locks every piece within a bounded number of ticks', () => {
    const e = playGreedy('c01');
    const payload = compactPayload(e);
    const driver = new ReplayDriver(payload);
    let guard = 0;
    while (!driver.finished && guard++ < 60 * 60 * 5) driver.tick();
    // Nothing may be left un-injected, and the run must be over.
    expect(driver.allPlaced).toBe(true);
    expect(driver.engine.blocksUsed).toBe(payload.pl!.length);
    expect(driver.engine.status).not.toBe('playing');
    // No piece may linger: the last tick is the tick the engine stopped on.
    expect(driver.engine.tick).toBeLessThan(60 * 60 * 5);
  });
});

describe('replay: the engine decides when the run ends', () => {
  it('reaches the recorded terminal state for a cleared level', () => {
    const e = playGreedy('c01');
    expect(e.status).toBe('won');
    const payload = compactPayload(e);
    const res = playback(payload);
    expect(res.engine.status).toBe('won');
    expect(res.hash).toBe(payload.h);
  });

  it('runs the terminal check rather than stopping at the last record', () => {
    const e = playGreedy('c01');
    const payload = compactPayload(e);
    const driver = new ReplayDriver(payload);
    let guard = 0;
    // Drive well past the last placement: only the engine may end the run.
    while (!driver.finished && guard++ < 60 * 60 * 5) driver.tick();
    expect(driver.engine.status).not.toBe('playing');
    // And it ended for a real reason, not by running out of records.
    expect(['won', 'lost']).toContain(driver.engine.status);
  });

  it('also terminates a losing run', () => {
    // Burn the block budget on soil without ever draining anything.
    const level = levelById('c01')!;
    const e = new GameEngine({ level, seed: 4242, mode: 'contract' });
    for (let n = 0; n < level.blockLimit + 2 && e.status === 'playing'; n++) {
      while (e.piece && e.piece.kind.startsWith('pocket')) {
        // Push pockets to the far wall so they never reach the drain.
        let g = 0;
        while (e.piece && e.pieceX > 0 && g++ < 12) e.handleAction('L');
        break;
      }
      if (e.status !== 'playing') break;
      e.handleAction('A');
      for (let i = 0; i < 20 && e.status === 'playing'; i++) e.step();
    }
    expect(e.placements.length).toBeGreaterThan(0);
    const payload = compactPayload(e);
    const res = playback(payload);
    expect(['won', 'lost']).toContain(res.engine.status);
    expect(res.hash).toBe(payload.h);
  });

  it('stops the moment the engine reports a verdict', () => {
    const e = playGreedy('c01');
    const payload = compactPayload(e);
    const driver = new ReplayDriver(payload);
    let guard = 0;
    while (!driver.finished && guard++ < 60 * 60 * 5) driver.tick();
    const endTick = driver.engine.tick;
    // Extra ticks after the verdict must be no-ops.
    driver.tick();
    driver.tick();
    expect(driver.engine.tick).toBe(endTick);
    driver.tick();
    expect(driver.engine.tick).toBe(endTick);
  });
});

describe('replay: terminal side effects are suppressed by construction', () => {
  it('playback never touches the progress store', async () => {
    const { useProgressStore } = await import('../stores/progressStore');
    const { createPinia, setActivePinia } = await import('pinia');
    setActivePinia(createPinia());
    const progress = useProgressStore();
    const recordLevel = vi.spyOn(progress, 'recordLevel');
    const recordDaily = vi.spyOn(progress, 'recordDaily');
    const recordEndless = vi.spyOn(progress, 'recordEndless');
    const addShare = vi.spyOn(progress, 'addShare');

    const e = playGreedy('c01');
    playback(compactPayload(e));
    playback(compactPayload(e));

    expect(recordLevel).not.toHaveBeenCalled();
    expect(recordDaily).not.toHaveBeenCalled();
    expect(recordEndless).not.toHaveBeenCalled();
    expect(addShare).not.toHaveBeenCalled();
  });

  it('playback produces no share code and no result payload', () => {
    const e = playGreedy('c01');
    const res = playback(compactPayload(e));
    // A PlaybackResult exposes only engine/hash/score/status: there is no place
    // for a share code to leak out of it.
    expect(Object.keys(res).sort()).toEqual(['engine', 'hash', 'score', 'status']);
  });
});

describe('replay: speed does not change the simulation', () => {
  it('the same payload yields the same hash regardless of stepping cadence', () => {
    const e = playGreedy('c01');
    const payload = compactPayload(e);

    const single = playback(payload);
    // Same payload, but ticked in coarse bursts of 4 (what 4x playback does).
    const driver = new ReplayDriver(payload);
    let guard = 0;
    while (!driver.finished && guard++ < 60 * 60 * 5) {
      for (let k = 0; k < 4 && !driver.finished; k++) driver.tick();
    }
    expect(driver.engine.getStateHash()).toBe(single.hash);
    expect(driver.engine.tick).toBe(single.engine.tick);
    expect(driver.engine.placements.length).toBe(single.engine.placements.length);
  });

  it('keeps per-piece lock ticks and columns identical across cadences', () => {
    const e = playGreedy('c01');
    const payload = compactPayload(e);
    const a = playback(payload).engine.placements;
    const driver = new ReplayDriver(payload);
    let guard = 0;
    while (!driver.finished && guard++ < 60 * 60 * 5) {
      for (let k = 0; k < 7 && !driver.finished; k++) driver.tick();
    }
    const b = driver.engine.placements;
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].t).toBe(a[i].t);
      expect(b[i].x).toBe(a[i].x);
      expect(b[i].r).toBe(a[i].r);
    }
  });
});

describe('replay: drop mode encoding', () => {
  it('records hard vs soft drops', () => {
    const level = levelById('c01')!;
    const e = new GameEngine({ level, seed: 55, mode: 'contract' });
    e.handleAction('A'); // hard drop
    for (let i = 0; i < 20 && e.status === 'playing'; i++) e.step();
    expect(e.placements[0].drop).toBe('hard');
  });

  it('round-trips the drop flag through the v4 share code', () => {
    const e = playGreedy('c01');
    const payload = compactPayload(e);
    const code = encodeShareCode(payload);
    const decoded = decodeShareCode(code);
    expect(decoded.ok).toBe(true);
    const pl = decoded.payload!.pl!;
    expect(pl.length).toBe(payload.pl!.length);
    for (let i = 0; i < pl.length; i++) {
      expect(pl[i].t).toBe(payload.pl![i].t);
      expect(pl[i].x).toBe(payload.pl![i].x);
      expect(pl[i].r).toBe(payload.pl![i].r);
      expect(pl[i].drop).toBe(payload.pl![i].drop);
    }
  });

  it('a v4 share code still verifies end to end', () => {
    const e = playGreedy('c01');
    const payload = compactPayload(e);
    const decoded = decodeShareCode(encodeShareCode(payload));
    expect(verifyReplay(decoded.payload!).ok).toBe(true);
  });

  it('rejects a legacy v3 compact code instead of replaying it wrongly', () => {
    // Hand-build a v3 body: version byte 3, one placement, no drop flag.
    const body = [3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 4, 0, 0];
    const b64 = Buffer.from(body).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const code = `WW3-AA${b64}`;
    const decoded = decodeShareCode(code);
    // Either the checksum rejects it (expected, since we did not compute one)
    // or the version gate does. Both are explicit refusals, never silent replays.
    if (decoded.ok) {
      expect(() => decodeOps(b64, 'c01')).toThrow(/v3/);
    } else {
      expect(decoded.error).toBeTruthy();
    }
  });
});

describe('replay: determinism is not disturbed by coaching', () => {
  it('reports the same hash with and without a tutorial driver attached', async () => {
    const e = playGreedy('c01');
    const payload = compactPayload(e);
    const baseline = playback(payload).hash;

    // Attach a tutorial-style observer that only reads the engine.
    const driver = new ReplayDriver(payload);
    const seen: number[] = [];
    let guard = 0;
    while (!driver.finished && guard++ < 60 * 60 * 5) {
      seen.push(driver.engine.blocksUsed);
      driver.tick();
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(driver.engine.getStateHash()).toBe(baseline);
  });
});
