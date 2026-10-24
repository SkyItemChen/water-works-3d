
import { describe, expect, it } from 'vitest';
import { DropTrails } from '../game/three/DropTrails';
import type { HardDropFx } from '../game/core/types';

function drop(t: number, fromY: number, toY: number): HardDropFx {
  return { t, x: 3, fromY, toY, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: '#8a5a3b', kind: 'sand' };
}

describe('hard-drop trail (presentation only)', () => {
  it('shows a trail for a while after a drop, then retires it', () => {
    const trails = new DropTrails();
    const cursor = { value: 0 };
    trails.sync([drop(10, 0, 12)], cursor);
    expect(trails.frame().length).toBe(1);
    expect(trails.frame()[0].fromY).toBe(0);
    expect(trails.frame()[0].toY).toBe(12);

    // ~0.16s lifetime: still visible early, gone soon after.
    trails.update(0.05);
    const mid = trails.frame();
    expect(mid.length).toBe(1);
    expect(mid[0].age).toBeGreaterThan(0);
    expect(mid[0].age).toBeLessThan(1);

    for (let i = 0; i < 10; i++) trails.update(0.05);
    expect(trails.frame().length).toBe(0);
  });

  it('does not replay a drop twice when the caller re-reads the log', () => {
    const trails = new DropTrails();
    const cursor = { value: 0 };
    const log = [drop(1, 0, 5)];
    trails.sync(log, cursor);
    trails.sync(log, cursor);
    expect(trails.frame().length).toBe(1);
  });

  it('recovers when the engine trimmed its log below the cursor', () => {
    const trails = new DropTrails();
    const cursor = { value: 40 };
    trails.sync([drop(1, 0, 4)], cursor);
    expect(trails.frame().length).toBe(0); // nothing new, cursor was clamped
    trails.sync([drop(1, 0, 4), drop(2, 1, 8)], cursor);
    expect(trails.frame().length).toBe(1); // only the new one
  });

  it('reset clears everything', () => {
    const trails = new DropTrails();
    const cursor = { value: 0 };
    trails.sync([drop(1, 0, 9)], cursor);
    expect(trails.frame().length).toBe(1);
    trails.reset();
    expect(trails.frame().length).toBe(0);
  });
});
