/**
 * Player-facing block descriptions for the main-menu codex.
 *
 * Pure data only: the geometry, names and colours are read from the block
 * catalogue so the guide can never drift from what actually falls in the well.
 */

import { ALL_BLOCK_KINDS, BLOCKS } from './bag';
import type { BlockKind } from './types';

export interface BlockGuideEntry {
  kind: BlockKind;
  /** short grouping label: 地形 / 水源 / 调流 / 净化 */
  role: string;
  /** one-line pitch shown next to the footprint */
  summary: string;
  /** how it behaves in the simulation */
  detail: string;
  /** what can go wrong with it */
  caution: string;
}

/**
 * Quarter turns (clockwise) that point the arrow along a conduit's `dir`.
 *
 * `dir` is 0 up / 1 right / 2 down / 3 left, and the drawn arrow (both the CSS
 * triangle and the Three.js geometry) points UP at 0°, so the mapping is the
 * identity. Getting this off by one silently shows the arrow pointing 90° away
 * from the direction water actually travels — worse than drawing nothing.
 *
 * Kept as one function because the codex, the HUD previews and the 3D viewport
 * all have to agree: two of them disagreeing is exactly how the arrow went
 * missing in the first place.
 */
export function arrowQuarterTurns(dir: number): number {
  return ((dir % 4) + 4) % 4;
}

export const BLOCK_GUIDE: Record<BlockKind, BlockGuideEntry> = {
  soil2: {
    kind: 'soil2',
    role: '地形',
    summary: '永久挡水的 2×2 墙体',
    detail: '落定后成为固定地形，水无法穿过。围池、隔断、抬高水位都靠它，是最基础的建材。',
    caution: '水压超过 1.0 会裂开，裂缝后每 tick 最多渗漏 0.05。',
  },
  soilL: {
    kind: 'soilL',
    role: '地形',
    summary: 'L 形三格土壤，可旋转四向',
    detail: '材质与 2×2 相同，但只占三格，适合塞角、补缺口、做阶梯式导流。',
    caution: '同样会被水压压裂，裂缝处开始漏水。',
  },
  pocket: {
    kind: 'pocket',
    role: '水源',
    summary: '落地即破，注入 4 单位清水',
    detail: '破裂瞬间把 4 单位清水灌进所占四格，装不下的会向上找空位。注入总量守恒，一滴不多一滴不少。',
    caution: '落在污水旁边会立刻把这一格清水染脏，前功尽弃。',
  },
  pocketDirty: {
    kind: 'pocketDirty',
    role: '水源',
    summary: '落地即破，注入 4 单位污水',
    detail: '同上，但倒出的是污水。污水只能进绿色污水口，不能与清水共用一条通道。',
    caution: '污水进清水口累计 3 单位就判负。',
  },
  sponge: {
    kind: 'sponge',
    role: '调流',
    summary: '最多吸 2 单位水，满了失效',
    detail: '相邻的水会被它吸走（约 0.5/tick），可以当临时蓄水池、堵住漏点；贴着过滤器还能把堵塞物带走。',
    caution: '水压超过 0.8 会被挤爆，把吸进去的水一次吐回来。',
  },
  pipe: {
    kind: 'pipe',
    role: '调流',
    summary: '强制沿箭头方向送水（格子上那个深色三角）',
    detail: '1×1，可旋转四向。格子上印着一个深色三角形，尖端即箭头方向。水进入后被以 0.24/tick 的速度推向箭头方向，比自由下落更快，用来写死一条水路。',
    caution: '水压超过 1.2 直接爆裂，格子里只剩空气。',
  },
  sand: {
    kind: 'sand',
    role: '地形',
    summary: '临时的 2×1 塞子，可旋转成竖条',
    detail: '能挡住水，适合封口或做一次性隔断；旋转后竖着放就能补一列的缺口。',
    caution: '受压超过 0.55 就塌：近一半情况整格消失，其余变成土壤——原本挡住的位置可能开始漏水。',
  },
  valve: {
    kind: 'valve',
    role: '调流',
    summary: '只沿箭头方向导流的单向阀',
    detail: '和管道一样强制转向，格子上同样印着深色三角箭头，落定前可旋转四向，适合把水锁在单行或单列里。',
    caution: '它自己不会爆裂：水堵在阀里时压力只会在原位堆积，直到把上方或相邻区块压坏、或从顶部漫出。',
  },
  filter: {
    kind: 'filter',
    role: '净化',
    summary: '污水过滤成清水，累计 3 单位后堵塞',
    detail: '污水经过时以 0.5/tick 转为清水，是唯一能把脏水洗回来的块，常放在污水口前的最后一道。',
    caution: '堵塞后该格不再进水，需要让海绵贴着它把堵塞物吸走。',
  },
  ice: {
    kind: 'ice',
    role: '地形',
    summary: '光滑面：水完全不停留',
    detail: '水流进冰块格会立刻向下或向两侧排走，不存水、不积压，适合做高速滑道和排水坡。',
    caution: '它挡不住水，只改变水的通过方式；把它当墙用会直接漏穿。',
  },
};

/** Guide entries in catalogue order, with the display name resolved. */
export const BLOCK_GUIDE_LIST = ALL_BLOCK_KINDS.map((kind) => ({
  ...BLOCK_GUIDE[kind],
  name: BLOCKS[kind].name,
  color: BLOCKS[kind].color,
  width: BLOCKS[kind].width,
  height: BLOCKS[kind].height,
  cells: BLOCKS[kind].cells,
  rotatable: BLOCKS[kind].rotatable,
  /**
   * Direction of the drawn arrow for conduits, in quarter turns clockwise from
   * "points right". `dir` itself is 0 up / 1 right / 2 down / 3 left, so a
   * right-pointing glyph needs dir-1 turns to point the right way.
   */
  arrow:
    kind === 'pipe' || kind === 'valve'
      ? arrowQuarterTurns(BLOCKS[kind].dir ?? 2)
      : undefined,
}));

