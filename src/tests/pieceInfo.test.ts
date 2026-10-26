/**
 * HUD description of the falling piece. The bug to avoid is a pre-rotation
 * thumbnail: a rotated L / sand / conduit must show the cells the player
 * actually controls, not the catalogue's default footprint.
 */
import { describe, expect, it } from 'vitest';
import { makePiece } from '../game/core/bag';
import { arrowQuarterTurns } from '../game/core/blockGuide';
import { currentPieceInfo } from '../game/core/pieceInfo';

describe('current piece info', () => {
  it('returns null when there is no falling piece', () => {
    expect(currentPieceInfo(null)).toBeNull();
  });

  it('resolves the catalogue name, role and guide text', () => {
    const piece = makePiece('soil2', 0);
    const info = currentPieceInfo(piece)!;
    expect(info.name).toBe('土壤 2×2');
    expect(info.role).toBe('地形');
    expect(info.summary).toContain('2×2');
    expect(info.detail.length).toBeGreaterThan(0);
    expect(info.caution.length).toBeGreaterThan(0);
    expect(info.color).toBe('#8a5a3b');
    expect(info.cellCount).toBe(4);
    expect([info.width, info.height]).toEqual([2, 2]);
  });

  it('measures the rotated footprint, not the default one', () => {
    const horizontal = currentPieceInfo(makePiece('sand', 0))!;
    const vertical = currentPieceInfo(makePiece('sand', 1))!;
    expect([horizontal.width, horizontal.height]).toEqual([2, 1]);
    expect([vertical.width, vertical.height]).toEqual([1, 2]);
  });

  it('shows the conduit direction the arrow actually points', () => {
    const piece = makePiece('pipe', 1);
    const info = currentPieceInfo(piece)!;
    expect(info.direction).toBe('左');
    expect(info.arrow).toBe(arrowQuarterTurns(piece.dir));
  });

  it('does not invent an arrow for solid blocks', () => {
    const info = currentPieceInfo(makePiece('ice', 0))!;
    expect(info.arrow).toBeUndefined();
    expect(info.direction).toBeUndefined();
  });
});
