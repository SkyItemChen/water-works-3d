/**
 * Playback *timing* regression suite.
 *
 * The other replay tests only look at the terminal state, which is why a replay
 * that teleported every piece straight onto its final square could pass them.
 * These tests watch the piece between ticks instead.
 */
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/core/engine';
import { ReplayDriver } from '../game/core/replay';
import { levelById } from '../game/core/level';
import type { ReplayPayload } from '../game/core/types';

/** Record a run using soft drops, so pieces really do travel between ticks. */
function recordWithFalling(seed: number): GameEngine {
  const level = levelById('c01')!;
  const e = new GameEngine({ level, seed, mode: 'contract' });
  const target = level.drains[0].x;
  let guard = 0;
  while (e.status === 'playing' && guard++ < 60) {
    if (!e.piece) {
      e.step();
      continue;
    }
    const want = e.piece.kind.startsWith('pocket') ? target : target - 2;
    let g = 0;
    while (e.piece && e.pieceX > want && g++ < 12) e.handleAction('L');
    g = 0;
    while (e.piece && e.pieceX < want && g++ < 12) e.handleAction('R');
    // Soft drop + step so the recorder observes real elapsed ticks.
    for (let n = 0; n < 40 && e.status === 'playing'; n++) {
      if (!e.piece || e.grounded) break;
      if (!e.handleAction('D')) break;
      e.step();
    }
    if (e.piece) e.handleAction('A');
    for (let i = 0; i < 30 && e.status === 'playing'; i++) e.step();
  }
  return e;
}

function payloadOf(e: GameEngine): ReplayPayload {
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

/**
 * Sample the active piece's row on every tick.
 *
 * Grouping is by `blocksUsed`, i.e. by piece index: the same block kind appears
 * many times per run, so grouping by kind would merge separate pieces.
 */
function traceRows(payload: ReplayPayload) {
  const driver = new ReplayDriver(payload);
  const rows: { tick: number; y: number; index: number }[] = [];
  let guard = 0;
  while (!driver.finished && guard++ < 8000) {
    driver.tick();
    const e = driver.engine;
    // `blocksUsed` counts locked pieces, so the airborne piece owns this index.
    rows.push({ tick: e.tick, y: e.piece ? e.pieceY : 0, index: e.blocksUsed });
  }
  return { driver, rows };
}

/** Highest row a piece reached before it locked (smallest y). */
function descentDepth(rows: { y: number; index: number }[], index: number): number {
  const ys = rows.filter((r) => r.index === index).map((r) => r.y);
  return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
}

describe('replay shows the piece falling', () => {
  it('moves the piece across multiple ticks before it locks', () => {
    const recorded = recordWithFalling(707);
    expect(recorded.status).toBe('won');
    const payload = payloadOf(recorded);
    const { rows } = traceRows(payload);

    // At least one piece must have travelled several rows while airborne. A
    // teleporting replay collapses every piece to a single row.
    const depths = payload.pl!.map((_, i) => descentDepth(rows, i));
    expect(Math.max(...depths)).toBeGreaterThan(3);
  });

  it('never drops a piece by more than a few rows in one tick', () => {
    const recorded = recordWithFalling(707);
    const payload = payloadOf(recorded);
    const { rows } = traceRows(payload);

    // Consecutive samples of the same airborne piece must move it gradually; a
    // teleport shows up as one enormous jump.
    let biggestJump = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].index !== rows[i - 1].index) continue;
      biggestJump = Math.max(biggestJump, Math.abs(rows[i].y - rows[i - 1].y));
    }
    expect(biggestJump).toBeLessThanOrEqual(4);
  });

  it('starts every piece near the top, never at its resting row', () => {
    const recorded = recordWithFalling(707);
    const payload = payloadOf(recorded);
    const { rows } = traceRows(payload);
    const firstY: number[] = [];
    for (let i = 0; i < payload.pl!.length; i++) {
      const sample = rows.find((r) => r.index === i);
      if (sample) firstY.push(sample.y);
    }
    expect(firstY.length).toBeGreaterThan(0);
    expect(Math.max(...firstY)).toBeLessThan(6);
  });

  it('still lands exactly where it was recorded', () => {
    const recorded = recordWithFalling(707);
    const payload = payloadOf(recorded);
    const { driver } = traceRows(payload);
    expect(driver.engine.getStateHash()).toBe(payload.h);
    expect(driver.engine.placements.length).toBe(payload.pl!.length);
    for (let i = 0; i < payload.pl!.length; i++) {
      expect(driver.engine.placements[i].x).toBe(payload.pl![i].x);
      expect(driver.engine.placements[i].r).toBe(payload.pl![i].r);
      expect(driver.engine.placements[i].t).toBe(payload.pl![i].t);
    }
  });

  it('keeps hard drops instantaneous', () => {
    // A run of consecutive hard drops packs records into very few ticks, so the
    // piece has no room to fall and must still lock on its recorded tick.
    const level = levelById('c01')!;
    const e = new GameEngine({ level, seed: 11, mode: 'contract' });
    for (let i = 0; i < 4 && e.status === 'playing'; i++) {
      if (e.piece) e.handleAction('A');
      e.step();
    }
    const payload = payloadOf(e);
    const { driver } = traceRows(payload);
    expect(driver.engine.getStateHash()).toBe(payload.h);
    expect(driver.engine.placements.length).toBe(payload.pl!.length);
  });
});

describe('replay progress bar matches the recording', () => {
  it('records totalTicks equal to the tick the run ended on', () => {
    const e = recordWithFalling(707);
    expect(e.status).toBe('won');
    // step() increments tick before checking the win, so the ending tick is the
    // last simulated tick and the scrub bar can use it verbatim.
    expect(e.tick).toBeGreaterThan(0);
    const payload = payloadOf(e);
    const { driver } = traceRows(payload);
    expect(driver.engine.tick).toBe(payload.tt);
    expect(driver.engine.tick).toBeLessThanOrEqual(payload.tt!);
  });

  it('stops exactly at the recorded total, leaving no idle tail', () => {
    const e = recordWithFalling(707);
    const payload = payloadOf(e);
    const { driver } = traceRows(payload);
    // Playback is already over, so the progress percentage is 100.
    expect(driver.engine.tick / payload.tt!).toBe(1);
  });

  it('a losing run also ends on its recorded tick', () => {
    const level = levelById('c01')!;
    const e = new GameEngine({ level, seed: 99, mode: 'contract' });
    for (let n = 0; n < level.blockLimit + 3 && e.status === 'playing'; n++) {
      if (!e.piece) {
        e.step();
        continue;
      }
      let g = 0;
      while (e.piece && e.pieceX > 0 && g++ < 12) e.handleAction('L');
      e.handleAction('A');
      for (let i = 0; i < 25 && e.status === 'playing'; i++) e.step();
    }
    if (e.status === 'playing') return; // budget never ran out; nothing to assert
    const payload = payloadOf(e);
    const { driver } = traceRows(payload);
    expect(driver.engine.status).toBe(e.status);
    expect(driver.engine.tick).toBe(payload.tt);
  });
});
