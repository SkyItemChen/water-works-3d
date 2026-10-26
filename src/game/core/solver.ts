/**
 * Maximum-score solver — pure logic, no DOM, no Three.
 *
 * The engine is deterministic, so "the best possible score of a level" is a
 * well defined search problem: for every piece choose a rotation, a column, and
 * how long to let it fall before slamming it. Brute force is hopeless (10
 * columns x up to 4 rotations x 10..30 pieces) and the water state is
 * continuous, so no exact DP exists. This module runs an anytime portfolio beam
 * search on real engine clones:
 *
 *   - every candidate is a cloned GameEngine, so the future piece stream and the
 *     water state are exact — there is no abstract model that can be wrong;
 *   - two timing policies are searched, because they win different levels:
 *     "settle" (each candidate is given time to drain before it is ranked, which
 *     makes the ranking honest but drops the next piece a few rows) and "wait"
 *     (steer at spawn row, then wait, which keeps every column reachable);
 *   - placements are pre-filtered with a *spread* shortlist (rotations x
 *     columns), never by value: before the water moves, every pipe ties with
 *     every other pipe, and ranking by value would silently drop sideways pipes;
 *   - every reported score is obtained by replaying the ops in a fresh engine
 *     until the run really ends. It is never an estimate.
 *
 * `upperBound()` is an admissible bound, so `upperBound - score` is a hard
 * "room left" figure. `proven` is true only if the search reached it.
 */

import { BLOCKS, makePiece } from './bag';
import { GameEngine } from './engine';
import { drainScore } from './scoring';
import { MAT, type LevelDefinition, type ReplayOp } from './types';

export interface SolveOptions {
  /** beam widths tried in order (0 = skip the beam, seed only) */
  beamWidths?: number[];
  /** hard wall-clock budget for one level, ms */
  timeBudgetMs?: number;
  /** placements per node kept for the expensive variants */
  perNode?: number;
  /** ticks each candidate is allowed to settle in the "settle" policy */
  settleTicks?: number;
  /** how many beam nodes are replayed to the real end at the end of a pass */
  finalists?: number;
  /** skip the tick-0 seeds: only lines a human could actually play */
  humanOnly?: boolean;
}

export interface SolveResult {
  levelId: string;
  /** 'won' when a winning line was found, 'unknown' otherwise */
  status: 'won' | 'unknown';
  score: number;
  upperBound: number;
  proven: boolean;
  blocksUsed: number;
  drainedClean: number;
  drainedDirty: number;
  wasted: number;
  ops: ReplayOp[];
  /** which strategy produced the line (see SolveSource) */
  source: SolveSource;
  nodes: number;
  ms: number;
}

/**
 * Where a winning line came from.
 *
 * seed / settle / wait advance the clock the way a person playing does: one
 * piece at a time, with real fall time in between. instant / chain build the
 * whole board on tick 0 (a hard drop costs no ticks, so the engine accepts it),
 * which no human hand can reproduce and which is therefore unusable as a public
 * score bar.
 */
export type SolveSource = 'seed' | 'settle' | 'wait' | 'instant' | 'chain' | 'none';

export function isHumanPace(source: SolveSource): boolean {
  return source === 'seed' || source === 'settle' || source === 'wait';
}

export interface ExpandOptions {
  /** extra fall time before the slam; 0 = slam immediately */
  waits: number[];
  /** how many placements get the expensive variants */
  perNode: number;
  /** when > 0, every shortlisted candidate is settled before ranking */
  settleTicks: number;
  /** ignore the spread shortlist and place every rotation x column */
  all: boolean;
  /** also try swapping the current piece into the hold slot first */
  useHold: boolean;
}

const DEFAULT_EXPAND: ExpandOptions = {
  waits: [0],
  perNode: 6,
  settleTicks: 0,
  all: false,
  useHold: true,
};

/** Cells water can travel through in the optimistic estimate. */
function passable(m: number): boolean {
  // Conduits carry water, so a pipe/valve/filter shaft counts as open. Soil,
  // sand, sponge and ice are walls here: the estimate must stay reachable.
  return m === MAT.Empty || m === MAT.Pipe || m === MAT.Valve || m === MAT.Filter;
}

export interface ReachStats {
  clean: number;
  dirty: number;
  /** share (0..1) of open cells in the top three rows that can still drain */
  topReach: number;
}

/**
 * Water sitting in cells that can still drain, plus how open the intake is.
 * Flow only goes down/left/right, so the reverse graph from a drain reaches up,
 * left and right.
 */
export function reachStats(e: GameEngine): ReachStats {
  const { cols, rows } = e;
  const n = cols * rows;
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const push = (j: number): void => {
    if (seen[j] || !passable(e.grid[j])) return;
    seen[j] = 1;
    stack.push(j);
  };
  for (const d of e.drains) {
    if (d.x < 0 || d.x >= cols || d.y < 0 || d.y >= rows) continue;
    const i = d.y * cols + d.x;
    if (!seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const x = i % cols;
    const y = (i - x) / cols;
    if (y > 0) push(i - cols);
    if (x > 0) push(i - 1);
    if (x + 1 < cols) push(i + 1);
  }
  let clean = 0;
  let dirty = 0;
  let topOpen = 0;
  let topReachable = 0;
  for (let i = 0; i < n; i++) {
    if (e.grid[i] !== MAT.Empty) continue;
    if (i < cols * 3) {
      topOpen++;
      if (seen[i]) topReachable++;
    }
    if (!seen[i]) continue;
    clean += e.clean[i];
    dirty += e.dirty[i];
  }
  return { clean, dirty, topReach: topOpen ? topReachable / topOpen : 0 };
}

/** Water that can still reach a drain, split by kind. */
export function reachableWater(e: GameEngine): { clean: number; dirty: number } {
  const s = reachStats(e);
  return { clean: s.clean, dirty: s.dirty };
}

/** Pockets among the current and next two pieces. */
function soonPockets(e: GameEngine): { clean: number; dirty: number } {
  const kinds = [e.piece?.kind, e.next[0], e.next[1]];
  let clean = 0;
  let dirty = 0;
  for (const k of kinds) {
    if (k === 'pocket') clean++;
    if (k === 'pocketDirty') dirty++;
  }
  return { clean, dirty };
}

/** Mean goal completion, 0..1. */
function goalProgress(e: GameEngine): number {
  if (!e.goals.length) return 0;
  let sum = 0;
  for (const g of e.goals) sum += g.target > 0 ? Math.max(0, Math.min(1, g.current / g.target)) : 0;
  return sum / e.goals.length;
}

/**
 * Ranking value for a mid-game state (optimistic, not a bound).
 *
 * Water still sitting in the field is worth much less than water that already
 * went through a drain (at the end of the run it is worth nothing at all), and
 * goal progress is quadratic because an unfinished contract scores zero however
 * much water was moved.
 */
function heuristic(e: GameEngine): number {
  const w = reachStats(e);
  const soon = soonPockets(e);
  const remainingBonus = 15 * Math.max(0, e.blockLimit - e.blocksUsed);
  const future = 10 * 4 * soon.clean * w.topReach * 0.35 + 4 * 4 * soon.dirty * w.topReach * 0.3;
  const gp = goalProgress(e);
  return (
    e.currentScore() +
    remainingBonus +
    10 * w.clean * 0.45 +
    4 * w.dirty * 0.45 +
    future +
    350 * gp * gp
  );
}

/** Score of a candidate as seen by the beam (exact once it has won). */
function rankOf(c: GameEngine): number {
  return c.status === 'won' ? c.score : heuristic(c);
}

/** Cheap state key, used to merge identical boards inside one beam layer. */
function stateSig(e: GameEngine): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < e.grid.length; i++) h = Math.imul(h ^ e.grid[i], 16777619) >>> 0;
  for (let i = 0; i < e.clean.length; i++) {
    h = Math.imul(h ^ (Math.round(e.clean[i] * 8) & 0xff), 16777619) >>> 0;
    h = Math.imul(h ^ (Math.round(e.dirty[i] * 8) & 0xff), 16777619) >>> 0;
  }
  return `${h}:${e.blocksUsed}:${e.hold ?? '-'}:${e.next[0] ?? '-'}`;
}

interface Candidate {
  engine: GameEngine;
  value: number;
}

/** Step until the drains stop moving (never before minTicks). */
function settle(e: GameEngine, maxTicks: number, minTicks = 0): void {
  let quiet = 0;
  for (let i = 0; i < maxTicks && e.status === 'playing'; i++) {
    const before = e.ledger.drainedClean + e.ledger.drainedDirty;
    e.step();
    const after = e.ledger.drainedClean + e.ledger.drainedDirty;
    if (after - before < 1e-4) {
      // Water keeps seeping long after the drain reading looks flat, so never
      // stop before minTicks.
      if (i >= Math.max(minTicks, 20) && ++quiet >= 4) return;
    } else {
      quiet = 0;
    }
  }
}

/** Steer the current piece to a column. Returns false when it cannot get there. */
function moveTo(c: GameEngine, col: number): boolean {
  let guard = 0;
  while (c.piece && c.pieceX !== col && guard++ < 24) {
    if (!c.handleAction(c.pieceX < col ? 'R' : 'L')) break;
  }
  return !!c.piece && c.pieceX === col;
}

/**
 * Placements available to the current piece.
 *
 * Phase 1 steers every (rotation, column) and, per policy, either slams it right
 * away or lets it fall for `waits[i]` ticks first. Phase 2 is where the water
 * gets a chance to move: either each shortlisted candidate is settled (honest
 * ranking, at the cost of altitude) or the wait variants carry the drainage.
 */
export function expand(e: GameEngine, opts: Partial<ExpandOptions> = {}): Candidate[] {
  const { waits, perNode, settleTicks, all, useHold } = { ...DEFAULT_EXPAND, ...opts };
  if (!e.piece) return [];

  /**
   * Two roots: play the piece we were given, or swap it into the hold slot
   * first. Hold is what lets a player skip a junk block and reach the third
   * water pocket two pieces earlier — without it the solver cannot explain a
   * legal 150 on level 1 while it claims 135 is the ceiling.
   */
  const roots: GameEngine[] = [e];
  if (useHold && !e.holdUsed && e.hold !== e.piece.kind) {
    const swapped = e.clone();
    swapped.handleAction('H');
    if (swapped.status === 'playing' && swapped.piece) roots.push(swapped);
  }

  const prepped: { c: GameEngine; r: number; col: number }[] = [];
  let anyRotatable = false;
  for (const root of roots) {
    const piece = root.piece;
    if (!piece) continue;
    const rots = BLOCKS[piece.kind].rotatable ? 4 : 1;
    if (rots > 1) anyRotatable = true;
    for (let r = 0; r < rots; r++) {
      const probe = makePiece(piece.kind, r);
      const maxCol = e.cols - probe.width;
      for (let col = 0; col <= maxCol; col++) {
        const c = root.clone();
        if (!c.piece) continue;
        let ok = true;
        for (let i = 0; i < r && ok; i++) ok = c.handleAction('C');
        if (!ok || !c.piece || !moveTo(c, col)) continue;
        prepped.push({ c, r, col });
      }
    }
  }
  if (!prepped.length) return [];

  // Spread shortlist: every column for a single-shape piece, an even spread of
  // columns per rotation otherwise. Picking by value would keep four identical
  // "pipe pointing down" candidates and lose the sideways ones.
  const groups = new Map<number, { c: GameEngine; r: number; col: number }[]>();
  for (const p of prepped) {
    const bucket = groups.get(p.r);
    if (bucket) bucket.push(p);
    else groups.set(p.r, [p]);
  }
  const subset: { c: GameEngine; r: number; col: number }[] = [];
  if (!anyRotatable) {
    subset.push(...prepped);
  } else {
    const quota = Math.max(2, Math.ceil(perNode / Math.max(2, groups.size)));
    for (const group of groups.values()) {
      const take = Math.min(quota, group.length);
      for (let i = 0; i < take; i++) {
        const idx = take === 1 ? 0 : Math.round((i * (group.length - 1)) / (take - 1));
        subset.push(group[idx]);
      }
    }
  }

  const base = !anyRotatable || all ? prepped : subset;
  const out: Candidate[] = [];
  for (const p of base) {
    const c = p.c.clone();
    c.handleAction('A');
    if (c.status === 'lost') continue;
    if (settleTicks > 0 && c.status === 'playing') settle(c, settleTicks + 20, settleTicks);
    out.push({ engine: c, value: rankOf(c) });
  }

  const waitFrom = all ? prepped : subset;
  for (const wait of waits) {
    if (wait === 0) continue;
    for (const p of waitFrom) {
      const c = p.c.clone();
      const spawnBefore = c.spawnCount;
      // wait < 0 means "let gravity place it": the piece falls until it locks.
      // That is the slowest thing a human can do with one piece, and the most
      // water time any single placement can buy.
      const limit = wait < 0 ? 600 : wait;
      for (let i = 0; i < limit && c.piece && c.status === 'playing' && c.spawnCount === spawnBefore; i++) {
        c.step();
      }
      // Only slam the piece that was steered: a long wait may already have
      // locked it and spawned the next one.
      if (c.status === 'playing' && c.piece && c.spawnCount === spawnBefore) c.handleAction('A');
      if (c.status === 'lost') continue;
      if (settleTicks > 0 && c.status === 'playing') settle(c, settleTicks + 20, settleTicks);
      out.push({ engine: c, value: rankOf(c) });
    }
  }
  return out;
}

/**
 * One-ply greedy rollout: at every piece take the placement that banks the most
 * (win > alive > score), which is the policy the solvability test-suite already
 * proves clears every contract level. It is the cheap floor: the beam can only
 * make the reported score better.
 */
export function greedySeed(level: LevelDefinition, perNode = 8): GameEngine {
  let e = new GameEngine({ level, seed: level.seed, mode: 'contract' });
  const bank = (k: Candidate): number =>
    k.engine.currentScore() + k.engine.ledger.drainedClean * 6 + k.engine.ledger.drainedDirty * 2;
  const order = (a: Candidate, b: Candidate): number => {
    const aw = a.engine.status === 'won' ? 1 : 0;
    const bw = b.engine.status === 'won' ? 1 : 0;
    if (aw !== bw) return bw - aw;
    const al = a.engine.status === 'lost' ? 1 : 0;
    const bl = b.engine.status === 'lost' ? 1 : 0;
    if (al !== bl) return al - bl;
    return bank(b) - bank(a);
  };
  for (let move = 0; move < level.blockLimit + 2 && e.status === 'playing'; move++) {
    if (!e.piece) {
      e.step();
      continue;
    }
    const kids = expand(e, { waits: [0, 70, 160], perNode });
    if (!kids.length) break;
    kids.sort(order);
    e = kids[0].engine;
  }
  return e;
}

/**
 * "Slam everything at tick 0" chain: steer each piece to one fixed column and
 * hard-drop it back to back, then let the water do the work.
 *
 * This is a real family of solutions — a hard drop costs no ticks, so the whole
 * board can be built before the water has moved at all, and the win lands while
 * the water drains afterwards. It is invisible to any ranking done mid-line
 * (nothing has moved yet, so every line scores the same), which is exactly why
 * it needs its own seed instead of a wider beam.
 */
function instantChain(level: LevelDefinition, col: number): GameEngine {
  const e = new GameEngine({ level, seed: level.seed, mode: 'contract' });
  for (let i = 0; i < level.blockLimit && e.status === 'playing'; i++) {
    if (!e.piece) {
      e.step();
      continue;
    }
    const width = e.piece.width;
    moveTo(e, Math.max(0, Math.min(col, level.cols - width)));
    if (!e.piece) break;
    e.handleAction('A');
  }
  return e;
}

/**
 * Greedy "speed build": drop every piece back to back (no clock advance at all)
 * but rank each candidate on a throwaway clone that is allowed to settle.
 *
 * All drops land on tick 0, which the engine happily accepts — a hard drop costs
 * no ticks — and the win then happens while the water drains afterwards. This
 * line is invisible to any mid-line ranking (nothing has moved yet), so it needs
 * its own seed; it is also how c21 is actually solved.
 */
export function instantGreedySeed(level: LevelDefinition, perNode = 8, probeTicks = 70): GameEngine {
  let e = new GameEngine({ level, seed: level.seed, mode: 'contract' });
  for (let move = 0; move < level.blockLimit && e.status === 'playing'; move++) {
    if (!e.piece) {
      e.step();
      continue;
    }
    const kids = expand(e, { waits: [0], perNode, all: true });
    if (!kids.length) break;
    for (const k of kids) {
      if (k.engine.status !== 'playing') continue;
      const probe = k.engine.clone();
      settle(probe, probeTicks + 30, probeTicks);
      k.value = probe.currentScore() + probe.ledger.drainedClean * 6 + probe.ledger.drainedDirty * 2 + 150 * goalProgress(probe);
    }
    kids.sort((a, b) => b.value - a.value);
    e = kids[0].engine;
  }
  return e;
}

/** Re-run a recorded op stream in a fresh engine until the run ends for real. */
export function replaySolution(level: LevelDefinition, ops: ReplayOp[]): GameEngine {
  const e = new GameEngine({ level, seed: level.seed, mode: 'contract' });
  let cur = 0;
  for (let guard = 0; guard < 400000 && e.status === 'playing'; guard++) {
    while (cur < ops.length && ops[cur].t <= e.tick) e.handleAction(ops[cur++].a);
    e.step();
  }
  return e;
}

/** Pieces the level will hand out, in order, over the whole block budget. */
function upcomingKinds(level: LevelDefinition): string[] {
  const e = new GameEngine({ level, seed: level.seed, mode: 'contract' });
  const seq: string[] = [];
  if (e.piece) seq.push(e.piece.kind);
  seq.push(...e.next, ...e.bag.peek(level.blockLimit + 1));
  return seq.slice(0, level.blockLimit);
}

/**
 * Admissible upper bound on any winning score.
 *
 * Assumes every unit of clean/dirty water the level can ever release reaches a
 * matching drain at full rate, with no waste or overflow, using the fewest
 * blocks the goals can possibly need. Real runs are always at or below this.
 */
export function upperBound(level: LevelDefinition): number {
  let initialClean = 0;
  let initialDirty = 0;
  for (const w of level.initialWater ?? []) {
    initialClean += w.clean ?? 0;
    initialDirty += w.dirty ?? 0;
  }
  const kinds = upcomingKinds(level);
  const cleanPockets = kinds.filter((k) => k === 'pocket').length;
  const dirtyPockets = kinds.filter((k) => k === 'pocketDirty').length;
  const totalClean = initialClean + cleanPockets * 4;
  const totalDirty = initialDirty + dirtyPockets * 4;

  let goalClean = 0;
  let goalDirty = 0;
  for (const g of level.goals) {
    if (g.type === 'drainClean') goalClean = Math.max(goalClean, g.amount ?? 0);
    if (g.type === 'drainDirty') goalDirty = Math.max(goalDirty, g.amount ?? 0);
  }
  // Water a goal still needs beyond the pre-filled field has to come from
  // pockets, and one pocket costs one block. Under-estimating block usage only
  // over-states the bonus, so the bound stays admissible.
  const blocksForClean = cleanPockets > 0 ? Math.ceil(Math.max(0, goalClean - initialClean) / 4) : 0;
  const blocksForDirty = dirtyPockets > 0 ? Math.ceil(Math.max(0, goalDirty - initialDirty) / 4) : 0;
  const minBlocks = Math.min(level.blockLimit, Math.max(0, blocksForClean, blocksForDirty));

  return Math.round(totalClean * 10 + totalDirty * 4 + 15 * (level.blockLimit - minBlocks));
}

/** The two timing policies; they crack different levels, so both are searched. */
const POLICIES: { name: string; opts: Partial<ExpandOptions> }[] = [
  { name: 'settle', opts: { waits: [0], settleTicks: 70 } },
  { name: 'wait', opts: { waits: [0, 70, 160, -1], settleTicks: 0 } },
];

export function solveLevel(level: LevelDefinition, opts: SolveOptions = {}): SolveResult {
  const t0 = Date.now();
  const beamWidths = (opts.beamWidths ?? [10, 30]).filter((w) => w > 0);
  const perNode = opts.perNode ?? 6;
  const settleTicks = opts.settleTicks ?? 70;
  const finalists = opts.finalists ?? 10;
  const deadline = t0 + (opts.timeBudgetMs ?? 10000);

  let nodes = 0;
  let best: { score: number; ops: ReplayOp[]; source: SolveSource } | null = null;

  const consider = (e: GameEngine, source: SolveSource): void => {
    if (e.status !== 'won') return;
    if (best && e.score <= best.score) return;
    best = { score: e.score, ops: e.ops.slice(), source };
  };

  const seed = greedySeed(level, Math.max(6, perNode));
  nodes++;
  consider(seed, 'seed');

  if (!opts.humanOnly) {
    // Speed-build variant: everything on tick 0, ranked on settled probes.
    nodes++;
    consider(replaySolution(level, instantGreedySeed(level, Math.max(6, perNode)).ops), 'instant');

    // One fixed-column instant chain per column, each replayed to the real end.
    for (let col = 0; col < level.cols; col++) {
      nodes++;
      const chain = instantChain(level, col);
      if (chain.status === 'won') {
        consider(chain, 'chain');
        continue;
      }
      consider(replaySolution(level, chain.ops), 'chain');
    }
  }

  // Each policy gets its own slice of the budget: the first one would otherwise
  // eat the whole clock and the second would never run.
  const perPolicy = Math.floor((opts.timeBudgetMs ?? 10000) / POLICIES.length);
  for (const policy of POLICIES) {
    const policyDeadline = Math.min(deadline, Date.now() + perPolicy);
    const expandOpts: Partial<ExpandOptions> =
      policy.name === 'settle' ? { ...policy.opts, settleTicks } : policy.opts;
    for (const beam of beamWidths) {
      if (Date.now() > policyDeadline) break;
      let frontier: GameEngine[] = [new GameEngine({ level, seed: level.seed, mode: 'contract' })];
      for (let depth = 0; depth < level.blockLimit && frontier.length; depth++) {
        const layer = new Map<string, Candidate>();
        let outOfTime = false;
        for (const node of frontier) {
          for (const cand of expand(node, { ...expandOpts, perNode })) {
            nodes++;
            consider(cand.engine, policy.name === 'settle' ? 'settle' : 'wait');
            const sig = stateSig(cand.engine);
            const prev = layer.get(sig);
            if (!prev || cand.value > prev.value) layer.set(sig, cand);
          }
          if (Date.now() > policyDeadline) {
            outOfTime = true;
            break;
          }
        }
        if (!layer.size) break;
        // Half the beam plays for score, half for goal completion. A pure score
        // ranking banks clean water forever and never finishes the contract; a
        // pure goal ranking finishes it before the score is banked.
        const all = [...layer.values()].sort((a, b) => b.value - a.value);
        const half = Math.max(1, Math.floor(beam / 2));
        const chosen = all.slice(0, half);
        if (all.length > half) {
          const rest = all.slice(half).sort((a, b) => {
            const gp = goalProgress(b.engine) - goalProgress(a.engine);
            return gp !== 0 ? gp : b.value - a.value;
          });
          chosen.push(...rest.slice(0, beam - half));
        }
        frontier = chosen.map((c) => c.engine);
        if (outOfTime) break;
      }
      // Water keeps flowing after the last placed block, so replay the finalists
      // until the run really ends before believing (or discarding) them.
      for (const node of frontier.slice(0, finalists)) {
        nodes++;
        const done = replaySolution(level, node.ops);
        if (done.status !== 'won') continue;
        if (best && done.score <= best.score) continue;
        best = {
          score: done.score,
          ops: node.ops.slice(),
          source: policy.name === 'settle' ? 'settle' : 'wait',
        };
      }
      if (Date.now() > policyDeadline) break;
    }
  }

  const ub = upperBound(level);
  const result: SolveResult = {
    levelId: level.id,
    status: best ? 'won' : 'unknown',
    score: best ? best.score : 0,
    upperBound: ub,
    proven: !!best && best.score >= ub,
    blocksUsed: 0,
    drainedClean: 0,
    drainedDirty: 0,
    wasted: 0,
    ops: best ? best.ops : [],
    source: best ? best.source : 'none',
    nodes,
    ms: Date.now() - t0,
  };
  if (best) {
    const done = replaySolution(level, best.ops);
    result.blocksUsed = done.blocksUsed;
    result.drainedClean = done.ledger.drainedClean;
    result.drainedDirty = done.ledger.drainedDirty;
    result.wasted = done.ledger.wasted;
    result.score = done.status === 'won' ? done.score : drainScore(done.ledger);
    result.proven = done.status === 'won' && result.score >= ub;
  }
  return result;
}
