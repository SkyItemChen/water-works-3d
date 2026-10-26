/**
 * challenge.json generator.
 *
 *   npm run solve -- --all --time 20000      # writes scripts/out/maxScores.json
 *   npm run gen:challenge                    # folds it into src/levels/challenge.json
 *
 * Every entry is round-tripped (encode -> decode -> replay) before it is written,
 * so the checked-in file can never contain a code that does not reach its target.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { contractLevels } from '../src/game/core/level';
import { isHumanPace, replaySolution, type SolveSource } from '../src/game/core/solver';
import { decodeShareCode, encodeShareCode } from '../src/game/core/shareCode';
import type { ReplayPayload } from '../src/game/core/types';

// Input path may be overridden; `--allow-machine` lets a tick-0 line through
// (it is flagged `pace: 'machine'` and shown as such in the UI).
const argv = process.argv.slice(2);
const SRC = argv.find((a) => !a.startsWith('--')) ?? 'scripts/out/maxScores.json';
const ALLOW_MACHINE = argv.includes('--allow-machine');
const OUT = 'src/levels/challenge.json';

interface SolverRow {
  id: string;
  status: string;
  score: number;
  blocksUsed: number;
  source?: SolveSource;
  ops: { t: number; a: string }[];
}

const solved = JSON.parse(readFileSync(SRC, 'utf8')) as { levels: SolverRow[] };
const rows: {
  id: string;
  index: number;
  target: number;
  blocks: number;
  code: string;
  pace: 'human' | 'machine';
}[] = [];
const problems: string[] = [];

for (const level of contractLevels()) {
  const row = solved.levels.find((r) => r.id === level.id);
  if (!row || row.status !== 'won' || !row.ops.length) {
    problems.push(`${level.id}: no winning line in ${SRC}`);
    continue;
  }
  const source: SolveSource = row.source ?? 'none';
  const pace = isHumanPace(source) ? 'human' : 'machine';
  if (pace === 'machine' && !ALLOW_MACHINE) {
    problems.push(
      `${level.id}: best line is ${source} (tick-0 build), not human pace. ` +
        `Re-run the solver with --human, or pass --allow-machine to ship it flagged.`,
    );
    continue;
  }
  const engine = replaySolution(level, row.ops as never);
  if (engine.status !== 'won') {
    problems.push(`${level.id}: replay ended ${engine.status}`);
    continue;
  }
  const payload: ReplayPayload = {
    v: 1,
    l: level.id,
    s: level.seed,
    o: row.ops as never,
    c: engine.score,
    h: engine.getStateHash(),
    r: 'won',
    tt: engine.tick,
    at: 0,
  };
  const code = encodeShareCode(payload);

  const decoded = decodeShareCode(code);
  if (!decoded.ok || !decoded.payload) {
    problems.push(`${level.id}: code does not decode (${decoded.error})`);
    continue;
  }
  const again = replaySolution(level, decoded.payload.o);
  if (again.status !== 'won' || again.score !== engine.score) {
    problems.push(`${level.id}: round trip ${again.status}/${again.score} vs ${engine.score}`);
    continue;
  }

  rows.push({
    id: level.id,
    index: level.index,
    target: engine.score,
    blocks: engine.blocksUsed,
    code,
    pace,
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} level(s) could not be baked; nothing written.`);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify(rows, null, 1) + '\n', 'utf8');
const longest = rows.reduce((n, r) => Math.max(n, r.code.length), 0);
const machine = rows.filter((r) => r.pace === 'machine').map((r) => r.id);
console.log(`wrote ${OUT}: ${rows.length} levels, longest code ${longest} chars`);
console.log(machine.length ? `machine pace: ${machine.join(', ')}` : 'all targets are human pace');
