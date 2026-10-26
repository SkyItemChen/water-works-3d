import { describe, expect, it } from 'vitest';
import { CHALLENGE_ENTRIES, humanPaceEntries, type ChallengeEntry } from '../game/core/challenge';
import { contractLevels, levelById } from '../game/core/level';
import { decodeShareCode, encodeShareCode } from '../game/core/shareCode';
import { replaySolution } from '../game/core/solver';
import type { ReplayPayload } from '../game/core/types';

/**
 * Data guard for challenge mode.
 *
 * The target score and the official replay code are generated from a solver run
 * and then frozen into challenge.json, so they can rot silently: a level edit
 * would move the real optimum without touching the file. These tests re-run every
 * bundled code and demand the exact score it advertises.
 */
describe('challenge data', () => {
  it('covers every contract level exactly once, in order', () => {
    const levels = contractLevels();
    expect(CHALLENGE_ENTRIES.length).toBe(levels.length);
    for (const level of levels) {
      const entry = CHALLENGE_ENTRIES.find((e) => e.id === level.id);
      expect(entry, `missing challenge entry for ${level.id}`).toBeTruthy();
      expect(entry?.index).toBe(level.index);
      expect(entry?.target ?? 0).toBeGreaterThan(0);
    }
    const indexes = CHALLENGE_ENTRIES.map((e) => e.index).sort((a, b) => a - b);
    expect(indexes).toEqual(levels.map((l) => l.index).sort((a, b) => a - b));
  });

  it('declares the pace of every target, with machine timing explicitly listed', () => {
    // A tick-0 build is engine-legal but not humanly reproducible, so it may only
    // ship for levels listed here (with a UI badge saying so).
    const MACHINE_ALLOWED = new Set<string>([]);
    for (const entry of CHALLENGE_ENTRIES) {
      const pace = entry.pace ?? 'human';
      expect(['human', 'machine'], `${entry.id} pace`).toContain(pace);
      if (pace === 'machine') {
        expect(MACHINE_ALLOWED.has(entry.id), `${entry.id} is machine pace`).toBe(true);
      }
    }
  });

  it('ships no machine-pace target', () => {
    // c21 used to be the one exception; the level itself was rebalanced instead
    // of shipping a bar only the framebuffer can reproduce.
    const machine = CHALLENGE_ENTRIES.filter((e) => (e.pace ?? 'human') === 'machine');
    expect(machine.map((e) => e.id)).toEqual([]);
  });

  it('the achievement scope drops machine-pace levels', () => {
    const fake: ChallengeEntry = { ...CHALLENGE_ENTRIES[0], id: 'fake', pace: 'machine' };
    const kept = humanPaceEntries([fake, CHALLENGE_ENTRIES[1]]);
    expect(kept.map((e) => e.id)).toEqual([CHALLENGE_ENTRIES[1].id]);
    expect(humanPaceEntries().length).toBe(CHALLENGE_ENTRIES.length);
  });

  it('every official code decodes to its own level and score', () => {
    for (const entry of CHALLENGE_ENTRIES) {
      const decoded = decodeShareCode(entry.code);
      expect(decoded.ok, `${entry.id}: ${decoded.error}`).toBe(true);
      expect(decoded.payload?.l).toBe(entry.id);
      expect(decoded.payload?.c).toBe(entry.target);
      expect(decoded.payload?.r).toBe('won');
    }
  });

  it('every official code replays to exactly the advertised score', () => {
    for (const entry of CHALLENGE_ENTRIES) {
      const level = levelById(entry.id)!;
      const decoded = decodeShareCode(entry.code);
      const engine = replaySolution(level, decoded.payload!.o);
      expect(engine.status, `${entry.id} ended ${engine.status}`).toBe('won');
      expect(engine.score, `${entry.id} scored ${engine.score}/${entry.target}`).toBe(entry.target);
    }
  }, 120000);

  it('code round-trips through encode/decode', () => {
    const entry = CHALLENGE_ENTRIES[0];
    const decoded = decodeShareCode(entry.code);
    const payload: ReplayPayload = { ...decoded.payload! };
    expect(encodeShareCode(payload)).toBe(entry.code);
  });
});
