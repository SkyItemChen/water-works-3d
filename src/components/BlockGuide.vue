<script setup lang="ts">
/**
 * BlockGuide — codex of every block that can fall into the well.
 *
 * Reads names, footprints and colours straight from the block catalogue, so a
 * new block shows up here as soon as it is added to `bag.ts`. Cards start
 * collapsed to one line and reveal the simulation detail on click.
 */
import { ref } from 'vue';
import { BLOCK_GUIDE_LIST } from '@/game/core/blockGuide';

const open = ref<string | null>(null);

function toggle(kind: string): void {
  open.value = open.value === kind ? null : kind;
}
</script>

<template>
  <section class="guide">
    <header class="guide-head">
      <h2>方块图鉴</h2>
      <p>{{ BLOCK_GUIDE_LIST.length }} 种方块 · 点击卡片看细节</p>
    </header>

    <div class="guide-grid">
      <div
        v-for="b in BLOCK_GUIDE_LIST"
        :key="b.kind"
        class="guide-card"
        :class="{ open: open === b.kind }"
        role="button"
        tabindex="0"
        :aria-expanded="open === b.kind"
        @click="toggle(b.kind)"
        @keydown.enter.prevent="toggle(b.kind)"
        @keydown.space.prevent="toggle(b.kind)"
      >
        <div class="guide-top">
          <div class="foot" :style="{ '--w': b.width, '--h': b.height, '--c': b.color }">
            <i v-for="(c, i) in b.cells" :key="i" :style="{ gridColumn: c.x + 1, gridRow: c.y + 1 }"></i>
            <span
              v-if="b.arrow !== undefined"
              class="foot-arrow"
              :style="{ '--rot': b.arrow * 90 + 'deg' }"
              aria-hidden="true"
            ><i></i></span>
          </div>
          <div class="guide-id">
            <h3>{{ b.name }}</h3>
            <div class="meta">
              <span class="role">{{ b.role }}</span>
              <span v-if="b.rotatable" class="rot" title="落定前可用 ↑ / X 旋转">可旋转</span>
            </div>
          </div>
        </div>

        <p class="summary">{{ b.summary }}</p>
        <p v-if="open === b.kind" class="detail">{{ b.detail }}</p>
        <p v-if="open === b.kind" class="caution">⚠ {{ b.caution }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.guide {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.guide-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  flex-wrap: wrap;
}
.guide-head h2 {
  margin: 0;
  font-size: 1rem;
  letter-spacing: 0.04em;
  color: #dceef8;
}
.guide-head p {
  margin: 0;
  font-size: 0.68rem;
  color: #6d8394;
}
.guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 0.6rem;
}
.guide-card {
  text-align: left;
  font: inherit;
  color: inherit;
  padding: 0.7rem 0.75rem;
  border-radius: 12px;
  border: 1px solid rgba(120, 190, 230, 0.14);
  background: linear-gradient(160deg, rgba(19, 31, 42, 0.9), rgba(9, 15, 21, 0.9));
  cursor: pointer;
  outline: none;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
}
.guide-card:focus-visible {
  border-color: rgba(127, 233, 255, 0.6);
  box-shadow: 0 0 0 2px rgba(127, 233, 255, 0.18);
}
.guide-card:hover {
  border-color: rgba(127, 233, 255, 0.38);
  transform: translateY(-2px);
}
.guide-card.open {
  border-color: rgba(127, 233, 255, 0.45);
  background: linear-gradient(160deg, rgba(24, 40, 54, 0.95), rgba(10, 18, 25, 0.95));
}
.guide-top {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.foot {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--w), 9px);
  grid-template-rows: repeat(var(--h), 9px);
  gap: 1.5px;
  padding: 3px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(120, 190, 230, 0.12);
  flex: 0 0 auto;
}
.foot-arrow {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  /* Drawn as a CSS triangle, not a glyph: font coverage for arrow characters
     is unreliable and a 9px glyph is invisible on a 1x screen. */
  transform: rotate(var(--rot));
  pointer-events: none;
  z-index: 1;
}
.foot-arrow i {
  width: 70%;
  height: 70%;
  background: #0b1720;
  clip-path: polygon(50% 0%, 100% 55%, 66% 55%, 66% 100%, 34% 100%, 34% 55%, 0% 55%);
}
.foot i {
  display: block;
  border-radius: 2px;
  background: var(--c);
  opacity: 0.9;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}
.guide-id {
  min-width: 0;
}
.guide-id h3 {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 650;
  line-height: 1.25;
}
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.2rem;
}
.rot {
  padding: 0.01rem 0.3rem;
  border-radius: 999px;
  font-size: 0.54rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: #0a1d26;
  background: rgba(127, 233, 255, 0.8);
  vertical-align: middle;
}
.role {
  display: inline-block;
  font-size: 0.58rem;
  letter-spacing: 0.1em;
  color: #8fb6cb;
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 999px;
  padding: 0.02rem 0.36rem;
}
.summary {
  margin: 0.5rem 0 0;
  font-size: 0.72rem;
  line-height: 1.55;
  color: #a8c2d3;
}
.detail {
  margin: 0.4rem 0 0;
  font-size: 0.7rem;
  line-height: 1.65;
  color: #8fa9bd;
  border-top: 1px dashed rgba(120, 190, 230, 0.14);
  padding-top: 0.4rem;
}
.caution {
  margin: 0.35rem 0 0;
  font-size: 0.68rem;
  line-height: 1.6;
  color: #e0a86a;
}
@media (max-width: 640px) {
  .guide-grid {
    grid-template-columns: 1fr 1fr;
  }
  .guide-card {
    padding: 0.6rem 0.55rem;
  }
  .guide-top {
    gap: 0.4rem;
  }
  .guide-id h3 {
    font-size: 0.78rem;
  }
  .foot {
    grid-template-columns: repeat(var(--w), 7px);
    grid-template-rows: repeat(var(--h), 7px);
  }
}
</style>






