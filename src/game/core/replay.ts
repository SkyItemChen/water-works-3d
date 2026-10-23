/**
 * Replay recording, encoding and playback.
 *
 * A replay stores only the operation stream (with engine ticks) plus the seed
 * and level id. Re-running the engine with the same inputs must reproduce the
 * identical final state hash.
 */

import { GameEngine, type Action } from './engine';
import { endlessLevel, levelById } from './level';
import { dailyLevelFromSeed } from './daily';
import { fnv1a } from './rng';
import type { LevelDefinition, Placement, ReplayOp, ReplayPayload, RunResult } from './types';
import { allGoalsDone } from './scoring';

const OP_CODES: Record<Action, number> = { L: 0, R: 1, C: 2, A: 3, D: 4, H: 5, S: 6 };
const CODE_OPS: Action[] = ['L', 'R', 'C', 'A', 'D', 'H', 'S'];

export function opCode(a: Action): number {
  return OP_CODES[a] ?? 0;
}

export function codeOp(c: number): Action {
  return CODE_OPS[c] ?? 'L';
}

/**
 * Record a play session by wrapping an engine. Every applied action is logged
 * with the tick, so playback can interleave simulated steps correctly.
 */
export class ReplayRecorder {
  readonly ops: ReplayOp[] = [];
  private baseTick: number;

  constructor(private readonly engine: GameEngine) {
    this.baseTick = engine.tick;
  }

  action(a: Action): boolean {
    const applied = this.engine.handleAction(a);
    if (applied) this.ops.push({ t: this.engine.tick, a });
    return applied;
  }

  step(): void {
    this.engine.step();
  }

  toPayload(): ReplayPayload {
    return {
      v: 1,
      l: this.engine.level.id,
      s: this.engine.seed,
      o: this.ops.map((op) => ({ t: op.t, a: op.a })),
      c: this.engine.score,
      h: this.engine.getStateHash(),
      r: this.engine.status === 'won' ? 'won' : 'lost',
      tt: this.engine.tick,
      at: 0,
    };
  }
}

/** Resolve the level a payload belongs to. Daily and endless runs are rebuilt
 * from their seed, so share codes stay self-contained and offline-safe. */
export function resolveLevel(payload: ReplayPayload): LevelDefinition | undefined {
  if (payload.l === 'daily') return dailyLevelFromSeed(payload.s, '每日挑战');
  if (payload.l === 'endless') return endlessLevel(payload.s);
  return levelById(payload.l);
}

export interface PlaybackResult {
  engine: GameEngine;
  hash: string;
  score: number;
  status: string;
}

/**
 * Re-simulate a replay from scratch. Returns the reconstructed engine so the
 * caller can render it. Deterministic: same payload -> same hash.
 */
export function playback(
  payload: ReplayPayload,
  level?: LevelDefinition,
  opts: { rewindStates?: boolean } = {},
): PlaybackResult {
  // Full op streams (v5 share codes) are the highest-fidelity source: they
  // contain every keypress the player made, at the tick they made it, so the
  // re-simulation reproduces the original motion exactly — every sideways step,
  // every soft-drop row and the hard-drop snap. Prefer them whenever present.
  if (payload.o && payload.o.length) return playbackLegacy(payload, level, opts);
  // Per-piece records (v4 share codes, and any older code) can only describe
  // where each piece ended up, so ReplayDriver reconstructs the fall.
  if (payload.pl && payload.pl.length) return playbackDriver(payload, level);
  return playbackLegacy(payload, level, opts);
}

/**
 * Replay of the legacy fine-grained operation stream.
 *
 * These payloads have no per-piece records, so the recorded `tt` (the tick the
 * original run ended on) is what bounds playback; there is nothing else that
 * could tell us where the recording stopped. Kept as-is so previously issued
 * codes keep reproducing their exact final hash.
 */
function playbackLegacy(
  payload: ReplayPayload,
  level?: LevelDefinition,
  opts: { rewindStates?: boolean } = {},
): PlaybackResult {
  void opts;
  const lvl = level ?? resolveLevel(payload);
  if (!lvl) throw new Error(`unknown level: ${payload.l}`);
  const engine = new GameEngine({ level: lvl, seed: payload.s, mode: 'replay' });

  const ops = payload.o.slice().sort((a, b) => a.t - b.t || 0);
  let cursor = 0;
  let guard = 0;
  const maxTicks = 60 * 60 * 30; // 30 minutes of sim time
  while (engine.status === 'playing' && guard < maxTicks) {
    guard++;
    // Ops are recorded at the tick at which they were applied, BEFORE that
    // tick's simulation step. Apply every due op first, then advance.
    while (cursor < ops.length && ops[cursor].t <= engine.tick) {
      engine.handleAction(ops[cursor++].a);
    }
    if (engine.status !== 'playing') break;
    // Replays that ended naturally stop at their recorded tick, so the final
    // water field is bit-identical to the original run.
    if (payload.tt !== undefined && engine.tick >= payload.tt) break;
    engine.step();
  }

  // Apply any trailing ops recorded on the final tick (e.g. a hard drop that
  // triggered the clear).
  while (cursor < ops.length && engine.status === 'playing') {
    engine.handleAction(ops[cursor++].a);
  }

  return {
    engine,
    hash: engine.getStateHash(),
    score: engine.currentScore(),
    status: engine.status,
  };
}

/** Compact replay: the engine decides when the run is over. */
function playbackDriver(payload: ReplayPayload, level?: LevelDefinition): PlaybackResult {
  const driver = new ReplayDriver(payload, level);
  const guardMax = 60 * 60 * 30;
  let guard = 0;
  while (!driver.finished && guard++ < guardMax) driver.tick();
  const engine = driver.engine;
  return {
    engine,
    hash: engine.getStateHash(),
    score: engine.currentScore(),
    status: engine.status,
  };
}

/** Strict verification used by tests and the share panel. */
export function verifyReplay(payload: ReplayPayload): { ok: boolean; reason: string; result?: PlaybackResult } {
  const res = playback(payload);
  if (payload.h && payload.h !== res.hash) {
    return { ok: false, reason: `state hash mismatch: expected ${payload.h}, got ${res.hash}`, result: res };
  }
  return { ok: true, reason: 'ok', result: res };
}

/** Compact binary-ish base64 alphabet for op streams (URL safe). */
function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Encode a replay as a base64url byte stream.
 *
 * v3 (compact, used for share codes):
 *   [3][levelIndex][seed:u32][score:u32][totalTicks:u32][result][count:u16]
 *   then per placement: [tickDelta:u16][x:u8][r:2bits | h:1bit]
 * v2 (legacy, full op stream):
 *   [2][levelIndex][seed:u32][score:u32][tt:u32][result][count:u16]
 *   then per op: [tickDelta:u16][action:u8]
 *
 * Compacting per piece instead of per keypress shrinks a typical clear from
 * ~250 characters to under 60, which is what makes the code shareable by voice
 * or chat. The explicit totalTicks lets a replay stop on the exact tick the
 * original run ended, so the reconstructed water field is bit-identical.
 */
export function encodeOps(payload: ReplayPayload): string {
  // v5 (full operation stream) is what makes a replay look like the run it
  // recorded. Fall back to per-piece (v4) only when there is no op stream.
  if (payload.o && payload.o.length) return encodeOps5(payload);
  if (payload.pl && payload.pl.length) return encodeCompact(payload);
  return encodeVerbose(payload);
}

/**
 * v5 — the complete operation stream, bit-packed.
 *
 * Every keypress is kept: column moves (L/R), rotations (C), soft drops (D),
 * hard drops (A), hold swaps (H). Playback therefore re-runs the *same* input
 * sequence through the same engine, so the block's motion on screen is the
 * motion the player actually produced: it walks sideways one cell at a time,
 * falls one row per gravity interval, and snaps down when space was pressed.
 *
 * Packing, per op: 3 bits of action + 4 bits of tick delta = 7 bits when the
 * gap is under 16 ticks (the common case — a player presses several keys within
 * the same few ticks). Longer gaps use one escape value (action slot 7) plus
 * 3 bits of action and a 16-bit delta. A burst of presses on one tick costs one
 * byte per press, which is what `o` always had — the old verbose v2 layout
 * spent three bytes per op.
 */
export function encodeOps5(payload: ReplayPayload): string {
  const ops = payload.o;
  const header = new Uint8Array(1 + 1 + 4 + 4 + 4 + 1 + 2);
  let p = 0;
  header[p++] = 5;
  header[p++] = levelIndexFor(payload.l) & 0xff;
  writeU32(header, p, payload.s >>> 0);
  p += 4;
  writeU32(header, p, Math.max(0, Math.round(payload.c)) >>> 0);
  p += 4;
  writeU32(header, p, Math.max(0, Math.round(payload.tt ?? 0)) >>> 0);
  p += 4;
  header[p++] = payload.r === 'won' ? 1 : 0;
  writeU16(header, p, Math.min(ops.length, 0xffff));

  const bits = new BitWriter();
  let prev = 0;
  for (const op of ops) {
    const delta = Math.max(0, op.t - prev);
    prev = op.t;
    const code = opCode(op.a);
    if (delta < 16) {
      bits.write(code, 3);
      bits.write(delta, 4);
    } else {
      bits.write(7, 3);
      bits.write(code, 3);
      bits.write(Math.min(delta, 0xffff), 16);
    }
  }
  const body = bits.finish();
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return toBase64Url(out);
}

/** LSB-first bit packer; unaligned on purpose so 7-bit ops stay 7 bits. */
class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private bits = 0;

  write(value: number, width: number): void {
    for (let i = 0; i < width; i++) {
      this.acc |= ((value >>> i) & 1) << this.bits;
      this.bits++;
      if (this.bits === 8) {
        this.bytes.push(this.acc & 0xff);
        this.acc = 0;
        this.bits = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.bits > 0) this.bytes.push(this.acc & 0xff);
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  private pos = 0;

  constructor(private readonly src: Uint8Array) {}

  read(width: number): number {
    let value = 0;
    for (let i = 0; i < width; i++) {
      const byteAt = this.pos >> 3;
      const bitAt = this.pos & 7;
      const byte = this.src[byteAt] ?? 0;
      value |= ((byte >>> bitAt) & 1) << i;
      this.pos++;
    }
    return value;
  }
}

export function encodeCompact(payload: ReplayPayload): string {
  const levelIndex = levelIndexFor(payload.l);
  const placements = payload.pl ?? [];
  const bytes = new Uint8Array(1 + 1 + 4 + 4 + 4 + 1 + 2 + placements.length * 4);
  let p = 0;
  bytes[p++] = 4;
  bytes[p++] = levelIndex & 0xff;
  writeU32(bytes, p, payload.s >>> 0);
  p += 4;
  writeU32(bytes, p, Math.max(0, Math.round(payload.c)) >>> 0);
  p += 4;
  writeU32(bytes, p, Math.max(0, Math.round(payload.tt ?? 0)) >>> 0);
  p += 4;
  bytes[p++] = payload.r === 'won' ? 1 : 0;
  writeU16(bytes, p, placements.length & 0xffff);
  p += 2;
  let prev = 0;
  for (const pl of placements) {
    writeU16(bytes, p, Math.min(Math.max(0, pl.t - prev), 0xffff));
    p += 2;
    prev = pl.t;
    bytes[p++] = Math.max(0, Math.min(255, pl.x));
    // bit0-1 rotation, bit2 hold-swap, bit3 hard drop (v4)
    bytes[p++] =
      ((pl.r & 0x03) | (pl.h ? 0x04 : 0) | (pl.drop === 'hard' ? 0x08 : 0)) & 0xff;
  }
  return toBase64Url(bytes);
}

function encodeVerbose(payload: ReplayPayload): string {
  const levelIndex = levelIndexFor(payload.l);
  const ops = payload.o;
  const bytes = new Uint8Array(1 + 1 + 4 + 4 + 4 + 1 + 2 + ops.length * 3);
  let p = 0;
  bytes[p++] = 2;
  bytes[p++] = levelIndex & 0xff;
  writeU32(bytes, p, payload.s >>> 0);
  p += 4;
  writeU32(bytes, p, Math.max(0, Math.round(payload.c)) >>> 0);
  p += 4;
  writeU32(bytes, p, Math.max(0, Math.round(payload.tt ?? 0)) >>> 0);
  p += 4;
  bytes[p++] = payload.r === 'won' ? 1 : 0;
  writeU16(bytes, p, ops.length & 0xffff);
  p += 2;
  let prev = 0;
  for (const op of ops) {
    const delta = Math.max(0, op.t - prev);
    prev = op.t;
    writeU16(bytes, p, Math.min(delta, 0xffff));
    p += 2;
    bytes[p++] = opCode(op.a);
  }
  return toBase64Url(bytes);
}

function writeU16(buf: Uint8Array, at: number, v: number): void {
  buf[at] = v & 0xff;
  buf[at + 1] = (v >>> 8) & 0xff;
}

function writeU32(buf: Uint8Array, at: number, v: number): void {
  buf[at] = v & 0xff;
  buf[at + 1] = (v >>> 8) & 0xff;
  buf[at + 2] = (v >>> 16) & 0xff;
  buf[at + 3] = (v >>> 24) & 0xff;
}

function readU16(buf: Uint8Array, at: number): number {
  return (buf[at] | (buf[at + 1] << 8)) >>> 0;
}

function readU32(buf: Uint8Array, at: number): number {
  return (buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16) | (buf[at + 3] << 24)) >>> 0;
}

function levelIndexFor(id: string): number {
  // Level ids encode their contract number (c01 -> 1). Daily and endless get
  // reserved sentinels so their replays can rebuild the level from the seed.
  if (id === 'daily') return 250;
  if (id === 'endless') return 251;
  const m = /^c(\d+)$/.exec(id);
  if (m) return parseInt(m[1], 10) & 0xff;
  return 200 + (fnv1a(id) % 50);
}

/** Map an encoded level index back to a level id. */
export function levelIdForIndex(index: number): string {
  if (index === 250) return 'daily';
  if (index === 251) return 'endless';
  if (index >= 1 && index <= 60) return `c${String(index).padStart(2, '0')}`;
  return '';
}

export function decodeOps(code: string, levelId: string): ReplayPayload {
  const bytes = fromBase64Url(code.trim());
  let p = 0;
  const version = bytes[p++] ?? 1;
  const levelIndex = bytes[p++] ?? 0;
  const seed = readU32(bytes, p);
  p += 4;
  const score = readU32(bytes, p);
  p += 4;
  const totalTicks = version >= 2 ? readU32(bytes, p) : 0;
  if (version >= 2) p += 4;
  const result = bytes[p++] === 1 ? 'won' : 'lost';
  const count = readU16(bytes, p);
  p += 2;
  const resolvedLevel = levelId || levelIdForIndex(levelIndex) || `c${String(levelIndex).padStart(2, '0')}`;

  if (version >= 5) {
    const ops: ReplayOp[] = [];
    const bits = new BitReader(bytes.subarray(p));
    let t = 0;
    for (let i = 0; i < count; i++) {
      const head = bits.read(3);
      if (head === 7) {
        const action = bits.read(3);
        t += bits.read(16);
        ops.push({ t, a: codeOp(action) });
      } else {
        t += bits.read(4);
        ops.push({ t, a: codeOp(head) });
      }
    }
    return {
      v: 1,
      l: resolvedLevel,
      s: seed,
      o: ops,
      c: score,
      h: undefined,
      r: result,
      tt: totalTicks || undefined,
      at: 0,
    };
  }

  if (version >= 3) {
    if (version < 4) {
      // v3 compact codes encoded no drop mode, so playback could not reproduce
      // the original trajectory. Refuse them explicitly instead of replaying
      // something that silently diverges.
      throw new Error('v3 紧凑短码已弃用，请重新生成分享码');
    }
    const placements: Placement[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      if (p + 4 > bytes.length) break;
      t += readU16(bytes, p);
      p += 2;
      const x = bytes[p++];
      const flags = bytes[p++];
      placements.push({
        t,
        x,
        r: flags & 0x03,
        h: (flags & 0x04) !== 0,
        drop: (flags & 0x08) !== 0 ? 'hard' : 'soft',
      });
    }
    return {
      v: 1,
      l: resolvedLevel,
      s: seed,
      o: [],
      pl: placements,
      c: score,
      h: undefined,
      r: result,
      tt: totalTicks || undefined,
      at: 0,
    };
  }

  const ops: ReplayOp[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    if (p + 3 > bytes.length) break;
    t += readU16(bytes, p);
    p += 2;
    ops.push({ t, a: codeOp(bytes[p++]) });
  }
  return {
    v: 1,
    l: resolvedLevel,
    s: seed,
    o: ops,
    c: score,
    h: undefined,
    r: result,
    tt: totalTicks || undefined,
    at: 0,
  };
}

/**
 * Replay a compact placement list. The heavy lifting is that the water field
 * is a pure function of tick count and materials, so we only need to reproduce
 * the piece sequence and drop points, not every keypress.
 */
export function playbackCompact(payload: ReplayPayload, level?: LevelDefinition): PlaybackResult {
  return playbackDriver(payload, level);
}

/** Build a RunResult from a finished engine. */
export function buildRunResult(engine: GameEngine): RunResult {
  return {
    won: engine.status === 'won',
    reason: engine.status === 'won' ? '合同完成' : engine.failureReason,
    score: engine.score,
    stars: engine.stars(),
    ledger: { ...engine.ledger },
    blocksUsed: engine.blocksUsed,
    goals: engine.goals.map((g) => ({ ...g })),
    hash: engine.getStateHash(),
    ops: engine.ops.slice(),
    seed: engine.seed,
    durationTicks: engine.tick,
  };
}

export function replayIsComplete(engine: GameEngine): boolean {
  return engine.status === 'won' || engine.status === 'lost' || allGoalsDone(engine.goals);
}

/**
 * Tick-driven player for compact (per-piece) replays.
 *
 * Design contract — do not bend it:
 *  - The engine is a plain `GameEngine`, the same class a real run uses. The
 *    terminal check inside `step()` (`win()` / `lose()`) therefore runs
 *    unchanged, and the replay stops only when *the engine* says the run ended.
 *    There is no "replay reached the last placement" stop condition, no
 *    `totalTicks` break, and no replay-specific copy of the terminal logic.
 *  - Suppressing end-of-run side effects (result overlay, progress writes,
 *    share code) is NOT this class's job: the caller owns its own engine and
 *    simply never calls `onWin`/`onLose`. Terminal detection and terminal
 *    consequences deliberately live in different places.
 *  - Progression is driven exclusively by `tick()` calls. No wall clock.
 *
 * Each record carries the tick at which the piece locked. Playback does NOT
 * teleport the piece onto its final square on that tick. Instead the piece is
 * steered to the recorded column and rotation as soon as the lock tick is
 * within reach, and then descends one row per tick through the engine's own
 * soft-drop path until it lands and locks on the recorded tick.
 *
 * The lock tick is what the water field depends on (the falling piece is not
 * part of the state hash), so the descent window is free: the block is on screen
 * for as many ticks as it needs to fall, and the state hash is still the
 * recorded one. Conversely, when records are packed too tightly to fit a
 * descent (a run of hard drops on consecutive ticks), the piece locks on the
 * spot exactly as before, because there is no tick to fall through.
 */
export class ReplayDriver {
  readonly engine: GameEngine;
  private readonly placements: Placement[];
  private readonly ops: ReplayOp[];
  private cursor = 0;
  private opCursor = 0;
  /**
   * Tick the recording stopped on, when it stopped before the engine had a
   * verdict. Only a safety net for truncated recordings — a run that ends
   * naturally is still ended by the engine's own check.
   */
  private readonly endTick: number | undefined;

  constructor(payload: ReplayPayload, level?: LevelDefinition) {
    const lvl = level ?? resolveLevel(payload);
    if (!lvl) throw new Error(`unknown level: ${payload.l}`);
    this.engine = new GameEngine({ level: lvl, seed: payload.s, mode: 'replay' });
    this.ops = payload.o.slice().sort((a, b) => a.t - b.t);
    // A full op stream is authoritative: it reproduces the original motion
    // keystroke by keystroke, so any per-piece records shipped alongside are
    // redundant (and strictly less faithful).
    this.placements = this.ops.length ? [] : (payload.pl ?? []).slice().sort((a, b) => a.t - b.t);
    this.endTick = payload.tt;
    // Per-piece payloads are replayed by steering one recorded drop per lock
    // tick, so the piece must be parked between drops (otherwise gravity would
    // lock it early and shift every later block). Op streams are driven by the
    // player's own presses instead and keep normal gravity, exactly like the
    // original run.
    this.engine.manualGravity = this.placements.length > 0;
  }

  /**
   * True once playback is over.
   *
   * Normally the engine ends the run itself (`won` / `lost`). A recording that
   * stopped before the engine reached a verdict still has a recorded end tick,
   * and the engine has nothing left to decide after it — so that also ends
   * playback, instead of spinning forever on a run that only ends when somebody
   * clicks away from it.
   */
  get finished(): boolean {
    if (this.engine.status !== 'playing') return true;
    return this.allPlaced && this.endTick !== undefined && this.engine.tick >= this.endTick;
  }

  /** Every recorded drop (or every recorded keypress) has been injected. */
  get allPlaced(): boolean {
    if (this.placements.length === 0) return this.opCursor >= this.ops.length;
    return this.cursor >= this.placements.length;
  }

  /** True when this driver replays a keystroke stream instead of drop points. */
  get isOpDriven(): boolean {
    return this.placements.length === 0 && this.ops.length > 0;
  }

  /**
   * Advance exactly one engine tick.
   *
   * The piece is steered to its recorded column/rotation as soon as the previous
   * piece locks, then walks down one step at a time (through the engine's own
   * soft-drop action) so playback shows the block falling. It reaches its
   * resting row exactly on the recorded lock tick, where it locks.
   */
  tick(): void {
    if (this.finished) return;
    if (this.placements.length === 0) {
      this.replayOpsDue();
      if (this.finished) return;
      this.engine.step();
      return;
    }
    this.advance();
    if (this.finished) return;
    this.engine.step();
  }

  /**
   * Legacy path: apply every recorded action whose tick has arrived, before
   * stepping — exactly the order the recorder used.
   */
  private replayOpsDue(): void {
    while (this.opCursor < this.ops.length && this.ops[this.opCursor].t <= this.engine.tick) {
      this.engine.handleAction(this.ops[this.opCursor++].a);
      if (this.finished) return;
    }
  }

  /**
   * Steer / descend / lock for the record under the cursor.
   *
   * The `while` loop is deliberate: several records can share one tick (a run of
   * hard drops), and a missed record would desynchronise every later piece, so
   * keep draining instead of silently skipping.
   */
  private advance(): void {
    const e = this.engine;
    while (this.cursor < this.placements.length && e.piece) {
      const pl = this.placements[this.cursor];

      if (this.steeredCursor !== this.cursor) {
        // Too late to animate (records packed tighter than a single tick):
        // reproduce it the only way left, as an instant drop.
        if (e.tick > pl.t) {
          this.steerTo(pl);
          if (e.piece) e.handleAction('A');
          this.cursor++;
          this.steeredCursor = -1;
          continue;
        }
        this.steerTo(pl);
        if (!e.piece) return;
        this.steeredCursor = this.cursor;
      }

      if (e.tick >= pl.t) {
        // Due now. `A` drops to the ghost row (a no-op if the piece already
        // rests there) and locks, so the cells are whatever they were recorded
        // as — never a guess.
        e.handleAction('A');
        this.cursor++;
        this.steeredCursor = -1;
        continue;
      }

      this.descend(pl.t);
      return;
    }
  }

  /**
   * Lower the piece toward its resting row, one row per tick.
   *
   * The landing row is re-read every tick through `ghostY()` rather than cached:
   * the simulation may collapse sand or burst a pipe between ticks and change
   * where the piece can come to rest. Locking always goes through `A`, so the
   * final cells are always the engine's own answer, never interpolated.
   *
   * If the recorded window is shorter than the number of rows to fall, the piece
   * takes bigger steps; if it is shorter still, it simply locks from wherever it
   * got to, which is the old instant behaviour.
   */
  private descend(lockTick: number): void {
    const e = this.engine;
    if (!e.piece) return;
    const rest = e.ghostY();
    const remaining = rest - e.pieceY;
    if (remaining <= 0) return;
    const ticksLeft = Math.max(1, lockTick - e.tick);
    const step = remaining > ticksLeft ? Math.ceil(remaining / ticksLeft) : 1;
    // Absolute row to reach this tick. The bound must NOT be recomputed from
    // `e.pieceY` inside the loop, or every successful move shifts the goal down
    // and the piece free-falls to the bottom in one tick.
    const targetRow = Math.min(rest, e.pieceY + step);
    let guard = 0;
    while (e.piece && e.pieceY < targetRow && guard++ < 64) {
      if (!e.handleAction('D')) break;
    }
  }

  /** Move the active piece to the recorded rotation and column (no drop). */
  private steerTo(pl: Placement): void {
    const e = this.engine;
    if (!e.piece) return;

    if (pl.h) {
      e.handleAction('H');
      if (!e.piece) return;
    }

    for (let r = 0; r < ((pl.r % 4) + 4) % 4; r++) e.handleAction('C');

    // Wall kicks can shift the piece while rotating, so the column walk has to
    // happen after the rotations.
    let guard = 0;
    while (e.piece && e.pieceX > pl.x && guard++ < 40) {
      if (!e.handleAction('L')) break;
    }
    guard = 0;
    while (e.piece && e.pieceX < pl.x && guard++ < 40) {
      if (!e.handleAction('R')) break;
    }
  }

  /** Which record the active piece has already been steered for. */
  private steeredCursor = -1;
}
