<script setup lang="ts">
/**
 * BlockGuide — standalone codex page for every block that can fall into the well.
 *
 * Reads names, footprints and colours straight from the block catalogue, so a
 * new block shows up here as soon as it is added to `bag.ts`. Cards start
 * collapsed to one line and reveal the simulation detail on click.
 */
import { ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { BLOCK_GUIDE_LIST } from '@/game/core/blockGuide';

const store = useGameStore();
/** One open entry across the whole grid: keeps the expanded copy scannable. */
const open = ref<string | null>(null);

function toggle(kind: string): void {
  open.value = open.value === kind ? null : kind;
}

function back(): void {
  store.toMenu();
}
</script>

<template>
  <div class="guide-page">
    <div class="bg" aria-hidden="true">
      <div class="glow"></div>
      <div class="grid-lines"></div>
    </div>

    <div class="content">
      <header class="page-head">
        <button class="back" @click="back">← 返回</button>
        <div class="title">
          <span class="kicker">方块档案</span>
          <h1>方块图鉴</h1>
          <p>{{ BLOCK_GUIDE_LIST.length }} 种方块 · 点击卡片查看用途、模拟细节与风险</p>
        </div>
        <div class="legend" aria-label="方块类型图例">
          <span><i class="dot terrain"></i>地形</span>
          <span><i class="dot water"></i>水源</span>
          <span><i class="dot flow"></i>调流</span>
          <span><i class="dot clean"></i>净化</span>
        </div>
      </header>

      <section class="guide-grid" aria-label="全部方块">
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
      </section>

      <footer class="page-foot">
        <span>方块顺序与水井中的 7-bag 出块池一致。</span>
        <span>提示：管道与单向阀的深色三角指向水流方向。</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.guide-page {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  background: radial-gradient(circle at 16% 0%, rgba(42, 157, 196, 0.2), transparent 46%),
    radial-gradient(circle at 92% 100%, rgba(126, 226, 168, 0.08), transparent 42%), #080d12;
  color: #e9f2f8;
  z-index: 30;
}
.bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.glow {
  position: absolute;
  width: 620px;
  height: 620px;
  top: -280px;
  left: 4%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(42, 157, 196, 0.36), transparent 70%);
  filter: blur(90px);
  opacity: 0.5;
}
.grid-lines {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(120, 190, 230, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120, 190, 230, 0.04) 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(ellipse at 50% 20%, black 20%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse at 50% 20%, black 20%, transparent 78%);
}
.content {
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto;
  padding: 1.4rem clamp(1rem, 4vw, 3rem) 3rem;
}
.page-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1.2rem;
  padding-bottom: 1.1rem;
  border-bottom: 1px solid rgba(120, 190, 230, 0.12);
}
.back {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(120, 190, 230, 0.2);
  color: #cfe4f2;
  border-radius: 9px;
  padding: 0.45rem 0.7rem;
  font-size: 0.78rem;
  cursor: pointer;
  white-space: nowrap;
  transition: 0.16s ease;
}
.back:hover {
  border-color: rgba(127, 233, 255, 0.5);
  background: rgba(127, 233, 255, 0.08);
}
.kicker {
  font-size: 0.64rem;
  letter-spacing: 0.18em;
  color: #7fe9ff;
  text-transform: uppercase;
}
.title h1 {
  margin: 0.12rem 0 0.22rem;
  font-size: clamp(1.65rem, 4vw, 2.3rem);
  line-height: 1.05;
  letter-spacing: 0.01em;
}
.title p {
  margin: 0;
  color: #8fa9bd;
  font-size: 0.76rem;
}
.legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.38rem 0.7rem;
  font-size: 0.62rem;
  color: #7f99aa;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.26rem;
  white-space: nowrap;
}
.dot {
  width: 0.38rem;
  height: 0.38rem;
  border-radius: 2px;
  display: inline-block;
}
.dot.terrain {
  background: #7ca6bd;
}
.dot.water {
  background: #55c7ff;
}
.dot.flow {
  background: #ffc274;
}
.dot.clean {
  background: #7ee2a8;
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
.page-foot {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.45rem 1rem;
  margin-top: 1.4rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(120, 190, 230, 0.1);
  color: #596f80;
  font-size: 0.64rem;
}
@media (max-width: 640px) {
  .content {
    padding-top: 1rem;
  }
  .page-head {
    grid-template-columns: 1fr auto;
    gap: 0.65rem 0.8rem;
    align-items: start;
  }
  .title {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .legend {
    justify-content: flex-end;
  }
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
@media (max-width: 520px) {
  .page-head {
    grid-template-columns: 1fr;
  }
  .back {
    justify-self: start;
    grid-row: 1;
  }
  .title {
    grid-column: 1;
    grid-row: 2;
  }
  .legend {
    grid-row: 3;
    justify-content: flex-start;
    gap: 0.25rem 0.5rem;
    font-size: 0.58rem;
  }
  .guide-grid {
    grid-template-columns: 1fr;
  }
  .guide-card {
    padding: 0.7rem 0.75rem;
  }
  .page-foot {
    flex-direction: column;
  }
}
</style>
