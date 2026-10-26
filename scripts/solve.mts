/**
 * Maximum-score CLI.
 *
 *   npm run solve -- --level c01
 *   npm run solve -- --all --time 8000 --out scripts/out/maxScores.json
 *
 * Writes one record per level: the best score found, the admissible upper
 * bound, the ops that reach it (replayable / verifiable), and the runtime.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { contractLevels, levelById } from '../src/game/core/level';
import { solveLevel, type SolveResult } from '../src/game/core/solver';
import { APP_VERSION } from '../src/game/core/version';

const argv = process.argv.slice(2);
function flag(name: string, fallback: string | null = null): string | null {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const next = argv[at + 1];
  if (!next || next.startsWith('--')) return 'true';
  return next;
}
function nums(name: string, fallback: number[]): number[] {
  const raw = flag(name);
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

const all = argv.includes('--all');
const wanted = (flag('level') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const beamWidths = nums('beam', [8, 24, 48]);
const waits = nums('waits', [0]);
const timeBudgetMs = Number(flag('time', '10000'));
const humanOnly = argv.includes('--human');
const settleTicks = Number(flag('settle', '80'));
const perNode = Number(flag('per-node', '4'));
const outPath = resolve(flag('out', 'scripts/out/maxScores.json') as string);

const levels = all
  ? contractLevels()
  : wanted.length
    ? wanted.map((id) => {
        const lv = levelById(id);
        if (!lv) throw new Error(`unknown level: ${id}`);
        return lv;
      })
    : [];

if (!levels.length) {
  console.error('usage: solve --level c01[,c02] | --all [--time ms] [--beam 8,24,48] [--settle 80] [--per-node 4] [--waits 0] [--out file]');
  process.exit(1);
}

const rows: SolveResult[] = [];
const t0 = Date.now();
for (const level of levels) {
  const r = solveLevel(level, { beamWidths, waits, timeBudgetMs, settleTicks, perNode, humanOnly });
  rows.push(r);
  const gap = r.upperBound - r.score;
  console.log(
    `${level.id.padEnd(5)} ${r.source.padEnd(7)} score=${String(r.score).padStart(5)} ub=${String(r.upperBound).padStart(5)} gap=${String(gap).padStart(4)} ${
      r.proven ? 'PROVEN' : '      '
    } blocks=${String(r.blocksUsed).padStart(2)} clean=${r.drainedClean.toFixed(1).padStart(5)} dirty=${r.drainedDirty.toFixed(1).padStart(4)} nodes=${String(r.nodes).padStart(6)} ${String(r.ms).padStart(6)}ms ${r.status}`,
  );
}

const totalMs = Date.now() - t0;
const won = rows.filter((r) => r.status === 'won');
console.log(
  `\n${won.length}/${rows.length} solved, proven ${rows.filter((r) => r.proven).length}, total ${(totalMs / 1000).toFixed(1)}s, avg ${(totalMs / rows.length / 1000).toFixed(2)}s/level`,
);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      solver: { beamWidths, waits, settleTicks, perNode, timeBudgetMs, humanOnly },
      levels: rows.map((r) => ({
        id: r.levelId,
        score: r.score,
        upperBound: r.upperBound,
        proven: r.proven,
        status: r.status,
        blocksUsed: r.blocksUsed,
        drainedClean: Number(r.drainedClean.toFixed(4)),
        drainedDirty: Number(r.drainedDirty.toFixed(4)),
        wasted: Number(r.wasted.toFixed(4)),
        ms: r.ms,
        source: r.source,
        ops: r.ops,
      })),
    },
    null,
    2,
  ),
);
console.log(`wrote ${outPath}`);
