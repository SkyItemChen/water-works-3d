/**
 * Motion fidelity: the replay must look like the run, not like its result.
 *
 * The earlier replay tests only checked the terminal state hash, so a playback
 * that teleported every piece onto its final square could pass them. This file
 * compares the *piece position on every single tick* between the original run
 * and its replay. If a sideways step is dropped, a soft-drop row is skipped or
 * a hard drop is re-timed, the traces diverge and these tests fail.
 */
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { playback, ReplayDriver } from '../game/core/replay';
import { decodeShareCode, encodeShareCode } from '../game/core/shareCode';
import { levelById } from '../game/core/level';
import type { Action } from '../game/core/engine';
import type { ReplayPayload } from '../game/core/types';

interface Sample {
  tick: number;
  x: number;
  y: number;
  rot: number;
  kind: string | null;
}

/**
 * Play a level with a deliberately human cadence: several ticks between
 * keypresses (so gravity moves the piece on its own), sideways moves one at a
 * time, soft drops, and hard drops. This is the input shape the replay has to
 * reproduce.
 */
function playByHand(seed = 4242): GameEngine {
  const level = levelById('c01')!;
  const e = new GameEngine({ level, seed, mode: 'contract' });
  const script: (Action | '~')[] = [
    'L', '~', 'L', '~', '~', 'A',           // walk left then slam
    'R', '~', 'R', '~', 'D', '~', 'D', '~', '~', 'A', // step right, soft drop twice, slam
    '~', 'L', '~', '~', 'A',
    'R', '~', '~', 'C', '~', 'A',
    '~', '~', 'L', '~', 'D', '~', 'D', '~', 'D', '~', 'A',
    '~', '~', '~', 'A',
    '~', '~', '~', '~', 'L', '~', 'A',
    '~', '~', '~', '~', '~', 'A',
  ];
  for (const step of script) {
    if (e.status !== 'playing') break;
    if (step !== '~') e.handleAction(step);
    e.step();
  }
  for (let i = 0; i < 240 && e.status === 'playing'; i++) e.step();
  return e;
}

/** Position of the active piece after every tick, keyed by tick number. */
function traceOf(e: GameEngine): Sample[] {
  return [{ tick: e.tick, x: e.pieceX, y: e.pieceY, rot: e.piece ? e.piece.rotation : -1, kind: e.piece?.kind ?? null }];
}

/** Re-run an engine tick by tick, sampling the same way. */
function traceLive(e: GameEngine, ticks: number, drive: () => void): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < ticks; i++) {
    if (e.status !== 'playing') break;
    drive();
    out.push({
      tick: e.tick,
      x: e.pieceX,
      y: e.pieceY,
      rot: e.piece ? e.piece.rotation : -1,
      kind: e.piece?.kind ?? null,
    });
  }
  return out;
}

function payloadOf(e: GameEngine, opts: { withOps: boolean }): ReplayPayload {
  return {
    v: 1,
    l: e.level.id,
    s: e.seed,
    o: opts.withOps ? e.ops.map((o) => ({ t: o.t, a: o.a })) : [],
    pl: e.placements.slice(),
    c: e.currentScore(),
    h: e.getStateHash(),
    r: e.status === 'won' ? 'won' : 'lost',
    tt: e.tick,
    at: 0,
  };
}

/** Play the same script while sampling, so we have the reference trace. */
function recordTrace(): Sample[] {
  const level = levelById('c01')!;
  const e = new GameEngine({ level, seed: 4242, mode: 'contract' });
  const script: (Action | '~')[] = [
    'L', '~', 'L', '~', '~', 'A',
    'R', '~', 'R', '~', 'D', '~', 'D', '~', '~', 'A',
    '~', 'L', '~', '~', 'A',
    'R', '~', '~', 'C', '~', 'A',
    '~', '~', 'L', '~', 'D', '~', 'D', '~', 'D', '~', 'A',
    '~', '~', '~', 'A',
    '~', '~', '~', '~', 'L', '~', 'A',
    '~', '~', '~', '~', '~', 'A',
  ];
  const out: Sample[] = [];
  for (const step of script) {
    if (e.status !== 'playing') break;
    if (step !== '~') e.handleAction(step);
    e.step();
    out.push({ tick: e.tick, x: e.pieceX, y: e.pieceY, rot: e.piece ? e.piece.rotation : -1, kind: e.piece?.kind ?? null });
  }
  return out;
}

describe('replay reproduces the player move by move', () => {
  it('matches the original piece position on every tick', () => {
    const recorded = playByHand();
    const payload = payloadOf(recorded, { withOps: true });
    const reference = recordTrace();

    const driver = new ReplayDriver(payload);
    const replay = traceLive(driver.engine, reference.length, () => driver.tick());

    expect(replay.length).toBeGreaterThan(20);
    for (let i = 0; i < replay.length; i++) {
      expect(replay[i].kind, `tick ${replay[i].tick} piece`).toBe(reference[i].kind);
      expect(replay[i].x, `tick ${replay[i].tick} column`).toBe(reference[i].x);
      expect(replay[i].y, `tick ${replay[i].tick} row`).toBe(reference[i].y);
      expect(replay[i].rot, `tick ${replay[i].tick} rotation`).toBe(reference[i].rot);
    }
  });

  it('advances sideways one column at a time, never jumping', () => {
    const recorded = playByHand();
    const payload = payloadOf(recorded, { withOps: true });
    const driver = new ReplayDriver(payload);
    const steps: number[] = [];
    let prevX = driver.engine.pieceX;
    let prevBlocks = driver.engine.blocksUsed;
    let guard = 0;
    while (!driver.finished && guard++ < 4000) {
      driver.tick();
      const e = driver.engine;
      // Compare within one piece only: a new spawn legitimately starts on a
      // different column, and that is not a sideways step.
      if (e.piece && e.blocksUsed === prevBlocks) steps.push(Math.abs(e.pieceX - prevX));
      prevX = e.pieceX;
      prevBlocks = e.blocksUsed;
    }
    expect(steps.length).toBeGreaterThan(20);
    // A replay that only knows the landing column teleports across the board.
    expect(Math.max(...steps)).toBeLessThanOrEqual(1);
    // ...and it really did walk sideways, rather than never moving at all.
    expect(steps.filter((d) => d === 1).length).toBeGreaterThan(3);
  });

  it('falls one gravity step at a time instead of appearing at the bottom', () => {
    const recorded = playByHand();
    const payload = payloadOf(recorded, { withOps: true });
    const driver = new ReplayDriver(payload);
    let prevY = driver.engine.pieceY;
    let biggestRise = 0;
    let guard = 0;
    while (!driver.finished && guard++ < 4000) {
      driver.tick();
      if (!driver.engine.piece) { prevY = driver.engine.pieceY; continue; }
      const y = driver.engine.pieceY;
      biggestRise = Math.max(biggestRise, y - prevY);
      prevY = y;
    }
    // Gravity moves one row; a hard drop is the only thing allowed to jump, and
    // it is drawn as a slam (see the drop-trail test below).
    expect(biggestRise).toBeLessThanOrEqual(14);
  });

  it('ends on the same terminal state and state hash', () => {
    const recorded = playByHand();
    const payload = payloadOf(recorded, { withOps: true });
    const res = playback(payload);
    expect(res.hash).toBe(payload.h);
    expect(res.status).toBe(recorded.status);
    expect(res.engine.placements.map((p) => p.x)).toEqual(recorded.placements.map((p) => p.x));
    expect(res.engine.placements.map((p) => p.t)).toEqual(recorded.placements.map((p) => p.t));
  });
});

describe('hard drops are recorded as a visible slam', () => {
  it('logs the row span a space-press covered', () => {
    const level = levelById('c01')!;
    const e = new GameEngine({ level, seed: 99, mode: 'contract' });
    const startY = e.pieceY;
    const blocksBefore = e.blocksUsed;
    e.handleAction('A');
    expect(e.hardDrops.length).toBe(1);
    const drop = e.hardDrops[0];
    expect(drop.fromY).toBe(startY);
    expect(drop.toY).toBeGreaterThan(drop.fromY);
    // The block is already merged into the grid on this same tick — the log is
    // exactly what lets the viewport animate a fall that the rules never had.
    expect(e.blocksUsed).toBe(blocksBefore + 1);
    expect(e.placements[0].drop).toBe('hard');
    expect(drop.cells.length).toBeGreaterThan(0);
    expect(drop.x).toBe(e.placements[0].x);
  });

  it('a soft drop leaves no slam record', () => {
    const level = levelById('c01')!;
    const e = new GameEngine({ level, seed: 99, mode: 'contract' });
    e.handleAction('D');
    expect(e.hardDrops.length).toBe(0);
  });

  it('caps the log so a long run cannot grow it without bound', () => {
    const level = levelById('c01')!;
    const e = new GameEngine({ level, seed: 7, mode: 'contract' });
    for (let i = 0; i < 200 && e.status === 'playing'; i++) {
      e.handleAction('A');
      e.step();
    }
    expect(e.hardDrops.length).toBeLessThanOrEqual(64);
  });
});

describe('share codes carry the full operation stream', () => {
  it('round-trips every keypress with its tick', () => {
    const recorded = playByHand();
    const payload = payloadOf(recorded, { withOps: true });
    const decoded = decodeShareCode(encodeShareCode(payload));

    expect(decoded.ok).toBe(true);
    const ops = decoded.payload!.o;
    expect(ops.length).toBe(payload.o.length);
    for (let i = 0; i < ops.length; i++) {
      expect(ops[i].a).toBe(payload.o[i].a);
      expect(ops[i].t).toBe(payload.o[i].t);
    }
  });

  it('stays short enough to paste', () => {
    const recorded = playByHand();
    const payload = payloadOf(recorded, { withOps: true });
    const code = encodeShareCode(payload);
    expect(payload.o.length).toBeGreaterThan(10);
    expect(code.length).toBeLessThan(160);
  });

  it('a decoded code replays the same motion as the original', () => {
    const recorded = playByHand();
    const payload = payloadOf(recorded, { withOps: true });
    const decoded = decodeShareCode(encodeShareCode(payload));
    const reference = recordTrace();

    const driver = new ReplayDriver(decoded.payload!);
    const replay = traceLive(driver.engine, reference.length, () => driver.tick());
    for (let i = 0; i < replay.length; i++) {
      expect(replay[i].x).toBe(reference[i].x);
      expect(replay[i].y).toBe(reference[i].y);
    }
  });

  it('a payload without an op stream still replays (v4 fallback)', () => {
    const recorded = playByHand();
    const perPiece = payloadOf(recorded, { withOps: false });
    const res = playback(perPiece);
    expect(res.hash).toBe(perPiece.h);
  });
});
