/**
 * Challenge mode data: every campaign level again, but the bar is the best score
 * the offline solver could reach (see core/solver.ts).
 *
 * `challenge.json` is generated from a full solver run. Each entry carries the
 * official replay code for its target, so a stuck player can concede and watch
 * exactly how the score is reached — no backend, no fetching, just a bundled
 * code that decodes with the same level data.
 *
 * Pure data + pure predicates: no engine, no store, no DOM.
 */

import raw from '../../levels/challenge.json';

/**
 * How the official line was played.
 * - human: real-time pace, one piece at a time — a person can copy it.
 * - machine: the board is built on tick 0 (a hard drop costs no ticks). The
 *   engine accepts it and the replay proves it, but no human hand can reproduce
 *   the timing, so such a target would be unfair as a score bar.
 */
export type ChallengePace = 'human' | 'machine';

export interface ChallengeEntry {
  /** level id, matches LevelDefinition.id */
  id: string;
  /** 1-based campaign index, for ordering */
  index: number;
  /** score the player has to reach (the solver's best human-pace line) */
  target: number;
  /** blocks the official line used, informational */
  blocks: number;
  /** share code of the official line */
  code: string;
  /** human-pace unless the level only had a tick-0 line (see ChallengePace) */
  pace?: ChallengePace;
}

export const CHALLENGE_ENTRIES: readonly ChallengeEntry[] = raw as ChallengeEntry[];

const BY_ID = new Map<string, ChallengeEntry>(CHALLENGE_ENTRIES.map((e) => [e.id, e]));

export function challengeEntry(id: string): ChallengeEntry | undefined {
  return BY_ID.get(id);
}

export function challengeTarget(id: string): number {
  return BY_ID.get(id)?.target ?? 0;
}

export function challengeCode(id: string): string {
  return BY_ID.get(id)?.code ?? '';
}

export function challengePace(id: string): ChallengePace {
  return BY_ID.get(id)?.pace ?? 'human';
}

/** True when the only known line for this level needs superhuman drop timing. */
export function isMachinePace(id: string): boolean {
  return challengePace(id) === 'machine';
}

/**
 * Levels that count toward challenge achievements.
 *
 * A target no human can reproduce must never gate a "clear them all" tier (and
 * conceding one is not a stain either), so machine-pace levels are excluded from
 * both sides of the ledger. Parameterised so the rule is testable without
 * depending on the shipped data.
 */
export function humanPaceEntries(
  entries: readonly ChallengeEntry[] = CHALLENGE_ENTRIES,
): ChallengeEntry[] {
  return entries.filter((e) => (e.pace ?? 'human') !== 'machine');
}

export type ChallengeOutcome = 'cleared' | 'short' | 'lost';

/**
 * Did this run meet the challenge? A run that fails the contract's own goals is
 * always 'lost'; a won run that banks less than the target is 'short'.
 */
export function challengeOutcome(won: boolean, score: number, target: number): ChallengeOutcome {
  if (!won) return 'lost';
  return score >= target ? 'cleared' : 'short';
}

export function isChallengeCleared(won: boolean, score: number, target: number): boolean {
  return challengeOutcome(won, score, target) === 'cleared';
}
