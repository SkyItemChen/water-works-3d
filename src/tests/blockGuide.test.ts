import { describe, expect, it } from 'vitest';
import { ALL_BLOCK_KINDS } from '../game/core/bag';
import { BLOCK_GUIDE, BLOCK_GUIDE_LIST } from '../game/core/blockGuide';

/**
 * The main-menu codex is data-driven, so the only real risk is drift: a block
 * added to the catalogue must get an entry, and every entry must carry text.
 */
describe('block guide', () => {
  it('covers every kind in the catalogue, in order', () => {
    expect(Object.keys(BLOCK_GUIDE).sort()).toEqual([...ALL_BLOCK_KINDS].sort());
    expect(BLOCK_GUIDE_LIST.map((b) => b.kind)).toEqual(ALL_BLOCK_KINDS);
  });

  it('has non-empty copy and a catalogue-backed name', () => {
    for (const entry of BLOCK_GUIDE_LIST) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.role.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.detail.length).toBeGreaterThan(0);
      expect(entry.caution.length).toBeGreaterThan(0);
      expect(entry.cells.length).toBeGreaterThan(0);
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
