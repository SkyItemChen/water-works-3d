/**
 * Verify a share code against the challenge target.
 *
 *   npm run verify -- WW3-XXXXXXXX...
 *
 * Decodes the code, replays it in a fresh engine and prints the real score,
 * block count and how it compares with the published target. This is the first
 * thing to run when someone reports a score the table does not explain: it tells
 * you instantly whether the claim is real, and whether the gap is in water or in
 * block usage.
 */
import { challengeEntry, isMachinePace } from '../src/game/core/challenge';
import { levelById } from '../src/game/core/level';
import { decodeShareCode } from '../src/game/core/shareCode';
import { replaySolution } from '../src/game/core/solver';

const code = process.argv.slice(2).find((a) => a.startsWith('WW3-'));
if (!code) {
  console.error('usage: verify -- WW3-XXXXXXXX  (the code the player shared)');
  process.exit(1);
}

const decoded = decodeShareCode(code);
if (!decoded.ok || !decoded.payload) {
  console.error('decode failed:', decoded.error);
  process.exit(1);
}

const payload = decoded.payload;
const level = levelById(payload.l);
if (!level) {
  console.log(`level ${payload.l} is not a contract level (payload claims ${payload.c} points)`);
  process.exit(0);
}

const engine = replaySolution(level, payload.o);
const target = challengeEntry(level.id);
const blocksUsed = engine.blocksUsed;
const holes = target ? target.target - engine.score : 0;

console.log(`level     ${level.id} ${level.name} (blockLimit ${level.blockLimit})`);
console.log(`replay    ${engine.status}, ${engine.tick} ticks`);
console.log(`score     ${engine.score}   (code claims ${payload.c})`);
console.log(`blocks    ${blocksUsed}  ->  bonus ${15 * Math.max(0, level.blockLimit - blocksUsed)}`);
console.log(`water     clean ${engine.ledger.drainedClean.toFixed(2)}  dirty ${engine.ledger.drainedDirty.toFixed(2)}  wasted ${engine.ledger.wasted.toFixed(2)}`);
if (target) {
  const pace = isMachinePace(level.id) ? 'machine' : 'human';
  const verdict =
    holes === 0 ? 'matches the target' : holes > 0 ? `${holes} below the target` : `${-holes} ABOVE the target`;
  console.log(`target    ${target.target} (${pace} pace) -> ${verdict}`);
  console.log(
    engine.score > target.target
      ? 'ACTIONS  the table is wrong: re-run the solver for this level before shipping'
      : 'OK       the table covers this line',
  );
}
