/**
 * Save file codec.
 *
 * Storage layout: positional arrays (no repeated key names, booleans as 0/1),
 * serialised as JSON and then base64url-encoded with a `WWSAVE1:` prefix. The
 * same text is used by the export/import panel *and* by the progress key in
 * localStorage, so there is exactly one format to keep correct.
 *
 * Reading is deliberately forgiving in exactly one direction: the v0.10.0
 * pretty-printed JSON bundle and the old object-shaped localStorage value are
 * still accepted, converted to arrays and then validated by the same code path.
 * Writing always produces the compact form.
 *
 * Nothing here throws on hostile input: a save that cannot be fully validated is
 * rejected whole, so a bad paste can never half-overwrite a player's progress.
 */

import type { DailyLeaderboardEntry } from './daily';
import type { ShareHistoryEntry } from './types';

/** Prefix on the encoded text, so format sniffing is trivial. */
export const SAVE_PREFIX = 'WWSAVE1:';
/** Legacy (v0.10.0) JSON envelope, still readable. */
export const SAVE_FORMAT = 'waterworks3d.save.v1';
/** Bumped when the array layout changes. */
const CODEC_VERSION = 1;

export interface LevelRecord {
  stars: number;
  bestScore: number;
  bestBlocks: number;
  cleared: boolean;
  attempts: number;
  lastPlayed: number;
}

export interface ChallengeRecord {
  cleared: boolean;
  conceded: boolean;
  bestScore: number;
  attempts: number;
  lastPlayed: number;
}

/** Shape of the whole local progress file. */
export interface ProgressSave {
  levels: Record<string, LevelRecord>;
  challenge: Record<string, ChallengeRecord>;
  achievements: Record<string, number>;
  challengeStreak: number;
  bestChallengeStreak: number;
  daily: Record<string, DailyLeaderboardEntry[]>;
  shareHistory: ShareHistoryEntry[];
  endlessBest: number;
  totalRuns: number;
  totalScore: number;
  tutorialDone: boolean;
}

export interface SettingsSave {
  muted: boolean;
  showPreview: boolean;
  quality: 'high' | 'medium' | 'low';
  reducedMotion: boolean;
  soundVolume: number;
}

export interface ParseResult {
  ok: true;
  progress: ProgressSave;
  /** null when the text carries progress only (the localStorage key). */
  settings: SettingsSave | null;
  version: string;
  exportedAt: number;
}

export type DecodeResult = ParseResult | { ok: false; error: string };

const QUALITIES: SettingsSave['quality'][] = ['high', 'medium', 'low'];

// --- base64url -------------------------------------------------------------

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(text: string): string {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// --- encode ----------------------------------------------------------------

const bit = (v: boolean): 0 | 1 => (v ? 1 : 0);

/** `[id, stars, bestScore, bestBlocks, cleared, attempts, lastPlayed]` */
function levelRows(levels: Record<string, LevelRecord>): unknown[][] {
  return Object.entries(levels).map(([id, r]) => [
    id,
    r.stars,
    r.bestScore,
    r.bestBlocks,
    bit(!!r.cleared),
    r.attempts,
    r.lastPlayed,
  ]);
}

/** `[id, cleared, conceded, bestScore, attempts, lastPlayed]` */
function challengeRows(challenge: Record<string, ChallengeRecord>): unknown[][] {
  return Object.entries(challenge).map(([id, r]) => [
    id,
    bit(!!r.cleared),
    bit(!!r.conceded),
    r.bestScore,
    r.attempts,
    r.lastPlayed,
  ]);
}

/** `[id, unlockedAt]` */
function achievementRows(achievements: Record<string, number>): unknown[][] {
  return Object.entries(achievements).map(([id, at]) => [id, at]);
}

/** `[date, [[date, score, blocks, won, at], ...]]` */
function dailyRows(daily: Record<string, DailyLeaderboardEntry[]>): unknown[][] {
  return Object.entries(daily).map(([date, list]) => [
    date,
    list.map((e) => [e.date, e.score, e.blocks, bit(!!e.won), e.at]),
  ]);
}

/** `[code, levelId, levelName, score, won, date]` */
function shareRows(shares: ShareHistoryEntry[]): unknown[][] {
  return shares.map((s) => [s.code, s.levelId, s.levelName, s.score, bit(!!s.won), s.date]);
}

function settingsRow(settings: SettingsSave): unknown[] {
  return [
    bit(!!settings.muted),
    bit(settings.showPreview !== false),
    Math.max(0, QUALITIES.indexOf(settings.quality)),
    bit(!!settings.reducedMotion),
    settings.soundVolume,
  ];
}

/**
 * Encode a save. `settings` may be null for the progress key, and `version` may
 * be empty; both are carried in the header for diagnostics only.
 */
export function encodeSave(
  progress: ProgressSave,
  settings: SettingsSave | null = null,
  version = '',
  now = Date.now(),
): string {
  const payload = [
    CODEC_VERSION,
    version,
    now,
    levelRows(progress.levels),
    challengeRows(progress.challenge),
    achievementRows(progress.achievements),
    progress.challengeStreak,
    progress.bestChallengeStreak,
    dailyRows(progress.daily),
    shareRows(progress.shareHistory),
    progress.endlessBest,
    progress.totalRuns,
    progress.totalScore,
    bit(!!progress.tutorialDone),
    settings ? settingsRow(settings) : null,
  ];
  return SAVE_PREFIX + toBase64(JSON.stringify(payload));
}

// --- decode ----------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isArray = Array.isArray;

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  return Math.round(num(v, fallback, min, max));
}

/** Accepts 1/0, true/false and "1" — hand-edited saves are a thing. */
function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

function str(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function idOf(v: unknown): string | null {
  const id = str(v, 64);
  return id ? id : null;
}

function decodeLevels(rows: unknown): Record<string, LevelRecord> {
  const out: Record<string, LevelRecord> = {};
  if (!isArray(rows)) return out;
  for (const row of rows) {
    if (!isArray(row)) continue;
    const id = idOf(row[0]);
    if (!id) continue;
    out[id] = {
      stars: int(row[1], 0, 0, 3),
      bestScore: int(row[2], 0, 0, 10_000_000),
      bestBlocks: int(row[3], 0, 0, 999),
      cleared: bool(row[4]),
      attempts: int(row[5], 0, 0, 1_000_000),
      lastPlayed: int(row[6], 0, 0, Number.MAX_SAFE_INTEGER),
    };
  }
  return out;
}

function decodeChallenge(rows: unknown): Record<string, ChallengeRecord> {
  const out: Record<string, ChallengeRecord> = {};
  if (!isArray(rows)) return out;
  for (const row of rows) {
    if (!isArray(row)) continue;
    const id = idOf(row[0]);
    if (!id) continue;
    out[id] = {
      cleared: bool(row[1]),
      conceded: bool(row[2]),
      bestScore: int(row[3], 0, 0, 10_000_000),
      attempts: int(row[4], 0, 0, 1_000_000),
      lastPlayed: int(row[5], 0, 0, Number.MAX_SAFE_INTEGER),
    };
  }
  return out;
}

function decodeAchievements(rows: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isArray(rows)) return out;
  for (const row of rows) {
    if (!isArray(row)) continue;
    const id = idOf(row[0]);
    const at = num(row[1], 0, 0, Number.MAX_SAFE_INTEGER);
    if (id && at > 0) out[id] = at;
  }
  return out;
}

function decodeDaily(rows: unknown): Record<string, DailyLeaderboardEntry[]> {
  const out: Record<string, DailyLeaderboardEntry[]> = {};
  if (!isArray(rows)) return out;
  for (const group of rows) {
    if (!isArray(group)) continue;
    const date = str(group[0], 32);
    const list = group[1];
    if (!date || !isArray(list)) continue;
    out[date] = list.filter(isArray).map((e) => ({
      date: str(e[0], 32) || date,
      score: int(e[1], 0, 0, 10_000_000),
      blocks: int(e[2], 0, 0, 999),
      won: bool(e[3]),
      at: int(e[4], 0, 0, Number.MAX_SAFE_INTEGER),
    }));
  }
  return out;
}

function decodeShares(rows: unknown): ShareHistoryEntry[] {
  if (!isArray(rows)) return [];
  return rows.filter(isArray).map((r) => ({
    code: str(r[0], 512),
    levelId: str(r[1], 64),
    levelName: str(r[2], 120),
    score: int(r[3], 0, 0, 10_000_000),
    won: bool(r[4]),
    date: int(r[5], 0, 0, Number.MAX_SAFE_INTEGER),
  }));
}

function decodeSettings(row: unknown): SettingsSave | null {
  if (!isArray(row)) return null;
  const q = int(row[2], 0, 0, QUALITIES.length - 1);
  return {
    muted: bool(row[0]),
    showPreview: row[1] === undefined ? true : bool(row[1]),
    quality: QUALITIES[q] ?? 'high',
    reducedMotion: bool(row[3]),
    soundVolume: num(row[4], 0.22, 0, 1),
  };
}

/**
 * v0.10.0 wrote a pretty-printed JSON bundle with object-shaped maps. Convert it
 * to the array layout so both paths share one validator.
 */
function legacyToArrays(bundle: Record<string, unknown>): unknown[] | null {
  const p = bundle.progress;
  if (!isObject(p)) return null;
  const levels = isObject(p.levels)
    ? Object.entries(p.levels).map(([id, r]) => {
        const rec = isObject(r) ? r : {};
        return [id, rec.stars, rec.bestScore, rec.bestBlocks, rec.cleared, rec.attempts, rec.lastPlayed];
      })
    : [];
  const challenge = isObject(p.challenge)
    ? Object.entries(p.challenge).map(([id, r]) => {
        const rec = isObject(r) ? r : {};
        return [id, rec.cleared, rec.conceded, rec.bestScore, rec.attempts, rec.lastPlayed];
      })
    : [];
  const achievements = isObject(p.achievements)
    ? Object.entries(p.achievements).map(([id, at]) => [id, at])
    : [];
  const daily = isObject(p.daily)
    ? Object.entries(p.daily).map(([date, list]) => [
        date,
        isArray(list)
          ? list.map((e) => {
              const rec = isObject(e) ? e : {};
              return [rec.date, rec.score, rec.blocks, rec.won, rec.at];
            })
          : [],
      ])
    : [];
  const shares = isArray(p.shareHistory)
    ? p.shareHistory.map((e) => {
        const rec = isObject(e) ? e : {};
        return [rec.code, rec.levelId, rec.levelName, rec.score, rec.won, rec.date];
      })
    : [];
  const s = isObject(bundle.settings) ? bundle.settings : {};
  return [
    CODEC_VERSION,
    str(bundle.version, 32),
    int(bundle.exportedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    levels,
    challenge,
    achievements,
    p.challengeStreak,
    p.bestChallengeStreak,
    daily,
    shares,
    p.endlessBest,
    p.totalRuns,
    p.totalScore,
    p.tutorialDone,
    [
      s.muted,
      s.showPreview,
      Math.max(0, QUALITIES.indexOf(s.quality as SettingsSave['quality'])),
      s.reducedMotion,
      s.soundVolume,
    ],
  ];
}

/** Decode base64 text, a legacy JSON bundle, or skip entirely (empty). */
export function decodeSave(text: string): DecodeResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: '存档内容为空' };

  let payload: unknown;
  if (trimmed.startsWith('{')) {
    let bundle: unknown;
    try {
      bundle = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: '不是合法的 JSON，请确认复制完整' };
    }
    if (!isObject(bundle) || bundle.format !== SAVE_FORMAT) {
      return { ok: false, error: `存档格式不匹配（需要 ${SAVE_PREFIX}… 或旧版 JSON）` };
    }
    payload = legacyToArrays(bundle);
    if (!payload) return { ok: false, error: '旧版存档缺少 progress 段' };
  } else {
    const body = trimmed.startsWith(SAVE_PREFIX) ? trimmed.slice(SAVE_PREFIX.length) : trimmed;
    if (!/^[A-Za-z0-9_-]+$/.test(body)) {
      return { ok: false, error: '不是存档文本（应以 WWSAVE1: 开头）' };
    }
    let json: string;
    try {
      json = fromBase64(body);
    } catch {
      return { ok: false, error: 'base64 解码失败，文本可能被截断' };
    }
    try {
      payload = JSON.parse(json);
    } catch {
      return { ok: false, error: '存档内容损坏（base64 解出来的不是 JSON）' };
    }
  }

  return asSave(payload);
}

/** Validate an already-array-shaped payload. Shared by every reader. */
function asSave(payload: unknown): DecodeResult {
  if (!isArray(payload)) return { ok: false, error: '存档根节点不是数组' };
  if (payload[0] !== CODEC_VERSION) {
    return { ok: false, error: `存档版本不支持（${String(payload[0])} ≠ ${CODEC_VERSION}）` };
  }

  return {
    ok: true,
    version: str(payload[1], 32),
    exportedAt: int(payload[2], 0, 0, Number.MAX_SAFE_INTEGER),
    progress: {
      levels: decodeLevels(payload[3]),
      challenge: decodeChallenge(payload[4]),
      achievements: decodeAchievements(payload[5]),
      challengeStreak: int(payload[6], 0, 0, 1_000_000),
      bestChallengeStreak: int(payload[7], 0, 0, 1_000_000),
      daily: decodeDaily(payload[8]),
      shareHistory: decodeShares(payload[9]),
      endlessBest: int(payload[10], 0, 0, 10_000_000),
      totalRuns: int(payload[11], 0, 0, 10_000_000),
      totalScore: int(payload[12], 0, 0, 1_000_000_000),
      tutorialDone: bool(payload[13]),
    },
    settings: decodeSettings(payload[14]),
  };
}

/**
 * Read the raw localStorage value.
 *
 * Three shapes have existed: the current base64 text, the v0.10.0 JSON envelope,
 * and the original bare `ProgressData` object. All three decode here so an
 * upgrade never drops a player's progress.
 */
export function decodeStoredProgress(text: string): ParseResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (!isObject(obj)) return null;
    const payload =
      obj.format === SAVE_FORMAT ? legacyToArrays(obj) : legacyToArrays({ progress: obj });
    if (!payload) return null;
    const parsed = asSave(payload);
    return parsed.ok ? parsed : null;
  }
  const parsed = decodeSave(trimmed);
  return parsed.ok ? parsed : null;
}
