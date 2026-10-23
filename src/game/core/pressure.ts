/**
 * Pressure bookkeeping and failure predicates.
 *
 * All functions are pure helpers; simulation.ts owns the mutation of pressure
 * during a tick. `pressure.ts` computes per-cell danger levels and the
 * "structural risk" summary used by the HUD and the renderer.
 */

import { MAT, type CellMeta } from './types';
import {
  PRESSURE_PIPE,
  PRESSURE_SAND,
  PRESSURE_SOIL,
  PRESSURE_SPONGE,
} from './constants';

export interface PressureInfo {
  /** 0..1 normalised danger for the cell */
  level: number;
  /** material threshold for the cell (0 if not destructible) */
  threshold: number;
  material: number;
}

export function thresholdFor(material: number): number {
  switch (material) {
    case MAT.Sand:
      return PRESSURE_SAND;
    case MAT.Soil:
      return PRESSURE_SOIL;
    case MAT.Pipe:
      return PRESSURE_PIPE;
    case MAT.Sponge:
      return PRESSURE_SPONGE;
    default:
      return 0;
  }
}

export function cellPressureInfo(material: number, pressure: number): PressureInfo {
  const threshold = thresholdFor(material);
  if (threshold === 0) return { level: 0, threshold, material };
  return { level: Math.min(1, pressure / threshold), threshold, material };
}

/** Highest danger level of any destructible cell. */
export function maxDanger(grid: Uint8Array, pressure: Float64Array): number {
  let max = 0;
  for (let i = 0; i < grid.length; i++) {
    const info = cellPressureInfo(grid[i], pressure[i]);
    if (info.level > max) max = info.level;
  }
  return max;
}

/** Does a cell need a visual crack overlay? */
export function isCrackedAt(grid: Uint8Array, meta: CellMeta[], i: number): boolean {
  if (grid[i] === MAT.Soil) return meta[i].cracked;
  return false;
}

/** Sum of all pressure, useful for HUD "system strain" readout. */
export function totalPressure(pressure: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < pressure.length; i++) sum += pressure[i];
  return sum;
}
