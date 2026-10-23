/** Global tuning constants. All simulation values are per fixed tick (60 Hz). */

export const TICK_RATE = 60;
export const FIXED_DT = 1 / TICK_RATE;

export const DEFAULT_COLS = 10;
export const DEFAULT_ROWS = 16;

/** total water capacity of one voxel */
export const CELL_CAPACITY = 1;
/** below this amount water is considered empty (prevents float dust) */
export const WATER_EPSILON = 0.0005;

/** maximum water transferred per tick when flowing straight down */
export const FLOW_DOWN = 0.16;
/** maximum water transferred per tick when flowing sideways */
export const FLOW_SIDE = 0.085;
/** how fast pipe / valve conduits push water */
export const FLOW_PIPE = 0.24;
/** water that can be absorbed by one sponge (total) */
export const SPONGE_CAPACITY = 2;
/** sponge absorption per tick */
export const SPONGE_ABSORB_RATE = 0.5;
/** dirty -> clean conversion per tick in a filter */
export const FILTER_RATE = 0.5;
/** units of water a filter can clean before it clogs */
export const FILTER_CLOG_LIMIT = 3;
/** pressure required to trigger failures */
export const PRESSURE_SAND = 0.55;
export const PRESSURE_SOIL = 1.0;
export const PRESSURE_PIPE = 1.2;
export const PRESSURE_SPONGE = 0.8;
export const PRESSURE_OVERFLOW = 0.6;
/** how fast pressure decays when a cell is not blocked */
export const PRESSURE_DECAY = 0.985;
/** pressure gained per unit of blocked inflow */
export const PRESSURE_GAIN = 0.95;

/** dirty water entering a clean drain this many units = loss */
export const POLLUTION_LIMIT = 3;
/** units of water spilling over the top that end the run */
export const OVERFLOW_LIMIT = 0.75;

/** score per unit */
export const SCORE_CLEAN_DRAIN = 10;
export const SCORE_DIRTY_DRAIN = 4;
export const SCORE_CLEAN_WASTED = -2;

/** block gravity */
export const GRAVITY_TICKS = 42;
export const LOCK_DELAY_TICKS = 8;
/** safe spawn columns margin */
export const SPAWN_MARGIN = 1;

export const WATER_COLORS = {
  clean: 0x39c5ff,
  dirty: 0x6f7a33,
  mix: 0x4e8c4a,
  overflow: 0xff5a5a,
};

export const MATERIAL_COLORS: Record<number, number> = {
  0: 0x000000,
  1: 0x8a5a3b, // soil
  2: 0xd8bd83, // sand
  3: 0xf2b6c6, // sponge
  4: 0x9aa7b4, // pipe
  5: 0xffc857, // valve
  6: 0xa8e6cf, // filter
  7: 0x35d0a0, // clean drain
  8: 0xc06b3f, // dirty drain
  9: 0xbfeaff, // ice
};

export const MODE_LABELS: Record<string, string> = {
  contract: '合同模式',
  daily: '每日挑战',
  endless: '无尽模式',
  replay: '回放',
};
