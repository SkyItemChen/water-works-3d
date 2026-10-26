/**
 * Merge solver outputs into one best-known table.
 *
 *   npm run merge:scores -- scripts/out/a.json scripts/out/b.json
 *
 * Keeps, per level, the highest-scoring *won* line across all inputs, then
 * writes scripts/out/maxScores.json (the input `gen:challenge` expects).
 * Human-pace sources are preferred for equal scores, because a target a player
 * cannot reproduce is worse than a slightly lower one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { contractLevels } from '../src/game/core/level';

const outAt = process.argv.indexOf('--out');
const OUT = outAt >= 0 ? process.argv[outAt + 1] : 'scripts/out/maxScores.json';
const HUMAN = new Set(['seed', 'settle', 'wait']);

interface Row {
  id: string;
  status: string;
  score: number;
  blocksUsed?: number;
  source?: string;
  ops: { t: number; a: string }[];
}

const inputs = process.argv
  .slice(2)
  .filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--out');
if (!inputs.length) {
  console.error('usage: merge:scores -- <solve-output.json> [more.json ...]');
  process.exit(1);
}

const best = new Map<string, Row>();
const levels = new Map(contractLevels().map((l) => [l.index, l]));

for (const file of inputs) {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { levels: Row[] };
  for (const row of parsed.levels) {
    if (row.status !== 'won' || !row.ops?.length) continue;
    const prev = best.get(row.id);
    if (!prev) {
      best.set(row.id, row);
      continue;
    }
    const humanEdge =
      HUMAN.has(row.source ?? '') && !HUMAN.has(prev.source ?? '') ? 1 : 0;
    const prevHumanEdge =
      HUMAN.has(prev.source ?? '') && !HUMAN.has(row.source ?? '') ? -1 : 0;
    const delta = row.score - prev.score;
    // Higher score wins; on a tie the human-pace line wins.
    if (delta > 0 || (delta === 0 && humanEdge === 1 && prevHumanEdge === 0)) {
      best.set(row.id, row);
    }
  }
}

const merged = [...levels.values()].sort((a, b) => a.index - b.index).map((l) => best.get(l.id));
const missing = merged.filter((r) => !r).map((_, i) => i + 1);
const rows = merged.filter((r): r is Row => !!r);

writeFileSync(OUT, JSON.stringify({ solver: { mergedFrom: inputs }, levels: rows }, null, 2) + '\n', 'utf8');
console.log(`wrote ${OUT}: ${rows.length}/${levels.size} levels with a winning line`);
const machine = rows.filter((r) => !HUMAN.has(r.source ?? ''));
if (machine.length) console.log(`non-human pace kept: ${machine.map((r) => r.id).join(', ')}`);
if (missing.length) console.log(`still missing (level index): ${missing.join(', ')}`);
