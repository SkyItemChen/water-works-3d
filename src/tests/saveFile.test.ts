import { describe, expect, it } from 'vitest';
import {
  decodeSave,
  decodeStoredProgress,
  encodeSave,
  SAVE_FORMAT,
  SAVE_PREFIX,
  type ProgressSave,
  type SettingsSave,
} from '../game/core/saveFile';

const progress = (): ProgressSave => ({
  levels: {
    c01: { stars: 3, bestScore: 150, bestBlocks: 6, cleared: true, attempts: 4, lastPlayed: 1 },
  },
  challenge: {
    c01: { cleared: true, conceded: false, bestScore: 150, attempts: 2, lastPlayed: 1 },
    c21: { cleared: false, conceded: true, bestScore: 0, attempts: 3, lastPlayed: 2 },
  },
  achievements: { first_clear: 1700000000000, challenge_first: 1700000000001 },
  challengeStreak: 3,
  bestChallengeStreak: 5,
  daily: {
    '2026-10-26': [{ date: '2026-10-26', score: 90, blocks: 5, won: true, at: 1 }],
  },
  shareHistory: [
    { code: 'WW3-ABxxxx', levelId: 'c01', levelName: '第一滴', score: 150, won: true, date: 1 },
  ],
  endlessBest: 88,
  totalRuns: 9,
  totalScore: 1234,
  tutorialDone: true,
});

const settings = (): SettingsSave => ({
  muted: true,
  showPreview: false,
  quality: 'medium',
  reducedMotion: true,
  soundVolume: 0.5,
});

/** Same base64url the codec writes, for hand-built hostile payloads. */
const b64 = (text: string): string =>
  Buffer.from(new TextEncoder().encode(text))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const legacyBundle = (p: ProgressSave, s: SettingsSave): string =>
  JSON.stringify(
    { format: SAVE_FORMAT, app: 'waterworks3d', version: '0.10.0', exportedAt: 42, progress: p, settings: s },
    null,
    2,
  );

describe('save file codec', () => {
  it('round-trips through the base64 array layout', () => {
    const text = encodeSave(progress(), settings(), '0.10.0', 42);
    expect(text.startsWith(SAVE_PREFIX)).toBe(true);
    expect(text).not.toContain('{');
    expect(text).not.toContain('bestScore');

    const parsed = decodeSave(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.progress).toEqual(progress());
    expect(parsed.settings).toEqual(settings());
    expect(parsed.version).toBe('0.10.0');
    expect(parsed.exportedAt).toBe(42);
  });

  it('carries progress only when no settings are given (localStorage key)', () => {
    const parsed = decodeSave(encodeSave(progress(), null));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.settings).toBeNull();
    expect(parsed.progress.levels.c01.bestScore).toBe(150);
  });

  it('is smaller than the pretty-printed JSON it replaces', () => {
    const compact = encodeSave(progress(), settings(), '0.10.0', 42);
    const legacy = legacyBundle(progress(), settings());
    expect(compact.length).toBeLessThan(legacy.length);
  });

  it('still imports a v0.10.0 JSON bundle, object maps and all', () => {
    const parsed = decodeSave(legacyBundle(progress(), settings()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.progress).toEqual(progress());
    expect(parsed.settings).toEqual(settings());
  });

  it('rejects empty, malformed and foreign payloads', () => {
    expect(decodeSave('')).toMatchObject({ ok: false });
    expect(decodeSave('   ')).toMatchObject({ ok: false });
    expect(decodeSave('not json at all!')).toMatchObject({ ok: false });
    expect(decodeSave('[]')).toMatchObject({ ok: false });
    expect(decodeSave(SAVE_PREFIX + '!!!')).toMatchObject({ ok: false });
    expect(decodeSave(JSON.stringify({ format: 'other', progress: {} }))).toMatchObject({ ok: false });
    expect(decodeSave(JSON.stringify({ format: SAVE_FORMAT }))).toMatchObject({ ok: false });
    // Array root, but a codec version we do not know.
    expect(decodeSave(SAVE_PREFIX + b64('[99,"v",0,[],[],[],0,0,[],[],0,0,0,0,null]'))).toMatchObject({
      ok: false,
    });
    // Base64 that decodes to something that is not JSON at all.
    expect(decodeSave(SAVE_PREFIX + b64('hello'))).toMatchObject({ ok: false });
  });

  it('sanitises hostile values instead of trusting them', () => {
    // Exactly the 15 slots the codec expects, every one of them poisoned.
    const payload = [
      1, // codec version
      'x'.repeat(100), // version string, over-long
      0, // exportedAt
      [
        ['c01', 99, -5, 0, 'yes', null, -1], // stars clamp, negative score, "yes" is not true
        [7, 1, 1, 1, 1, 1, 1], // numeric id -> dropped
      ],
      [
        ['c02', 1, true, 1e12, -3, 0],
        [null, 1, 1, 1, 1, 1], // null id -> dropped
      ],
      [
        ['bad', -1], // timestamp <= 0 -> dropped
        ['ok', 5],
      ],
      -3, // challengeStreak
      -1, // bestChallengeStreak
      'nope', // daily: not an array
      ['high', 'not-a-number', null], // shareHistory: rows are not arrays
      9, // endlessBest
      'high', // totalRuns: not a number
      -20, // totalScore
      1, // tutorialDone
      [1, 0, 7, 0, 9], // settings: quality 7 clamps to low, volume clamps to 1
    ];
    const parsed = decodeSave(SAVE_PREFIX + b64(JSON.stringify(payload)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.progress.levels.c01.stars).toBe(3);
    expect(parsed.progress.levels.c01.bestScore).toBe(0);
    expect(parsed.progress.levels.c01.cleared).toBe(false); // "yes" is not true
    expect(parsed.progress.levels.c01.lastPlayed).toBe(0);
    expect(Object.keys(parsed.progress.levels)).toEqual(['c01']);
    expect(parsed.progress.challenge.c02.cleared).toBe(true); // 1 counts as true
    expect(parsed.progress.challenge.c02.bestScore).toBe(10_000_000);
    expect(parsed.progress.challenge.c02.attempts).toBe(0);
    expect(parsed.progress.achievements).toEqual({ ok: 5 });
    expect(parsed.progress.challengeStreak).toBe(0);
    expect(parsed.progress.daily).toEqual({});
    expect(parsed.progress.shareHistory).toEqual([]);
    expect(parsed.progress.endlessBest).toBe(9);
    expect(parsed.progress.totalRuns).toBe(0);
    expect(parsed.progress.totalScore).toBe(0);
    expect(parsed.progress.tutorialDone).toBe(true);
    expect(parsed.settings?.quality).toBe('low');
    expect(parsed.settings?.soundVolume).toBe(1);
    expect(parsed.version.length).toBe(32);
  });

  it('defaults a missing settings block rather than failing the import', () => {
    const payload = [1, 'v', 0, [['c01', 1, 10, 3, 1, 1, 1]], [], [], 0, 0, [], [], 0, 0, 0, 0, null];
    const parsed = decodeSave(SAVE_PREFIX + b64(JSON.stringify(payload)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.settings).toBeNull();
    expect(parsed.progress.levels.c01.cleared).toBe(true);
  });

  it('reads the old bare object out of localStorage', () => {
    const parsed = decodeStoredProgress(JSON.stringify(progress()));
    expect(parsed?.progress).toEqual(progress());
  });

  it('reads the encoded text out of localStorage', () => {
    const parsed = decodeStoredProgress(encodeSave(progress(), null, '0.10.0'));
    expect(parsed?.progress).toEqual(progress());
    expect(parsed?.settings).toBeNull();
  });

  it('returns null for a corrupt stored value', () => {
    expect(decodeStoredProgress('{oops')).toBeNull();
    expect(decodeStoredProgress('')).toBeNull();
    expect(decodeStoredProgress('WWSAVE1:!!!')).toBeNull();
  });
});
