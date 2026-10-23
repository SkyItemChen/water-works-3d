<script setup lang="ts">
/**
 * NextPreview — 2D mini block silhouettes for the next pieces.
 * The first entry is highlighted as the immediately upcoming piece.
 */
import { computed } from 'vue';
import { BLOCKS } from '@/game/core/bag';
import { arrowQuarterTurns } from '@/game/core/blockGuide';
import type { BlockKind } from '@/game/core/types';

const props = withDefaults(
  defineProps<{
    kinds: BlockKind[];
    cols?: number;
    rows?: number;
  }>(),
  { cols: 10, rows: 16 },
);

const blocks = computed(() =>
  props.kinds.slice(0, 3).map((kind, index) => {
    const def = BLOCKS[kind];
    return {
      kind,
      def,
      first: index === 0,
      cells: def.cells,
      w: def.width,
      h: def.height,
      // A fresh piece is always at rotation 0, so its arrow is the default `dir`.
      arrow: kind === 'pipe' || kind === 'valve' ? arrowQuarterTurns(def.dir ?? 2) : undefined,
    };
  }),
);
</script>

<template>
  <div class="next-preview">
    <div
      v-for="b in blocks"
      :key="b.kind + '-' + b.first"
      class="preview-card"
      :class="{ first: b.first }"
      :title="b.def.name"
    >
      <div class="grid" :style="{ '--w': b.w, '--h': b.h, '--c': b.def.color }">
        <i
          v-for="(c, i) in b.cells"
          :key="i"
          :style="{ gridColumn: c.x + 1, gridRow: c.y + 1 }"
        ></i>
        <!-- Conduits push water along a direction the square cannot show. -->
        <span
          v-if="b.arrow !== undefined"
          class="arrow"
          :style="{ '--rot': b.arrow * 90 + 'deg' }"
          aria-hidden="true"
        ><i></i></span>
      </div>
      <span class="name">{{ b.def.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.next-preview {
  display: flex;
  gap: 0.35rem;
  align-items: flex-end;
}
.preview-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.28rem;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(120, 190, 230, 0.14);
  opacity: 0.7;
  transition: 0.15s ease;
}
.preview-card.first {
  opacity: 1;
  border-color: rgba(127, 233, 255, 0.5);
  background: rgba(127, 233, 255, 0.08);
  box-shadow: 0 0 14px rgba(80, 200, 255, 0.18);
}
.grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--w), 0.5rem);
  grid-template-rows: repeat(var(--h), 0.5rem);
  gap: 1px;
}
.arrow {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  /* CSS triangle, not a glyph: arrow characters are not reliably covered by
     every font and turn into tofu boxes. */
  transform: rotate(var(--rot));
  pointer-events: none;
  z-index: 1;
}
.arrow i {
  width: 80%;
  height: 80%;
  background: #0b1720;
  clip-path: polygon(50% 0%, 100% 55%, 66% 55%, 66% 100%, 34% 100%, 34% 55%, 0% 55%);
}
.grid i {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 1.5px;
  background: var(--c);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.3);
}
.name {
  font-size: 0.52rem;
  color: #94afc2;
  white-space: nowrap;
}
@media (max-width: 900px) {
  .preview-card .name {
    display: none;
  }
  .grid {
    grid-template-columns: repeat(var(--w), 0.42rem);
    grid-template-rows: repeat(var(--h), 0.42rem);
  }
  .grid i {
    width: 0.42rem;
    height: 0.42rem;
  }
}
</style>
