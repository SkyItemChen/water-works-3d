/**
 * Read-only description of the piece currently falling.
 *
 * Kept out of the Vue component so the HUD only has to render strings and
 * numbers: names, roles and behaviour text all come from the catalogue / guide,
 * and the footprint is measured from the *rotated* cells the engine published.
 */
import { BLOCKS } from './bag';
import { BLOCK_GUIDE, arrowQuarterTurns } from './blockGuide';
import type { BlockCell, BlockKind } from './types';

export interface CurrentPieceInfo {
  kind: BlockKind;
  name: string;
  role: string;
  summary: string;
  detail: string;
  caution: string;
  rotatable: boolean;
  /** Catalogue colour, so the HUD glyph matches the 3D piece. */
  color: string;
  /** Rotated footprint, already normalised to start at (0,0). */
  cells: readonly BlockCell[];
  width: number;
  height: number;
  cellCount: number;
  /** Quarter turns clockwise for the conduit arrow. Undefined for other blocks. */
  arrow?: number;
  /** Where a pipe/valve pushes water; undefined for other blocks. */
  direction?: '上' | '右' | '下' | '左';
}

const DIRECTIONS = ['上', '右', '下', '左'] as const;

type PieceLike = {
  kind: BlockKind;
  cells: readonly BlockCell[];
  dir?: number;
};

/**
 * Resolve the active piece to display data, or null when nothing is falling.
 *
 * `cells` are the engine's post-rotation cells, so the footprint and the arrow
 * update on every successful rotation without any extra state.
 */
export function currentPieceInfo(piece: PieceLike | null | undefined): CurrentPieceInfo | null {
  if (!piece) return null;
  const def = BLOCKS[piece.kind];
  const guide = BLOCK_GUIDE[piece.kind];
  const cells = piece.cells.map((c) => ({ ...c }));
  const width = cells.reduce((m, c) => Math.max(m, c.x + 1), 0);
  const height = cells.reduce((m, c) => Math.max(m, c.y + 1), 0);
  const conduit = piece.kind === 'pipe' || piece.kind === 'valve';
  const dir = ((piece.dir ?? def.dir ?? 2) % 4 + 4) % 4;
  return {
    kind: piece.kind,
    name: def.name,
    role: guide.role,
    summary: guide.summary,
    detail: guide.detail,
    caution: guide.caution,
    rotatable: def.rotatable,
    color: def.color,
    cells,
    width,
    height,
    cellCount: cells.length,
    arrow: conduit ? arrowQuarterTurns(dir) : undefined,
    direction: conduit ? DIRECTIONS[dir] : undefined,
  };
}
