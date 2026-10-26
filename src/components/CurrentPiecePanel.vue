<script setup lang="ts">
/**
 * CurrentPiecePanel — what is falling right now.
 *
 * A read-only side card: footprint (post-rotation), name, role, dimensions,
 * rotation affordance and conduit direction. It never writes state; the HUD
 * feeds it `currentPieceInfo(snapshot.piece)`, so it updates on every move and
 * rotation exactly when the viewport does.
 */
import type { CurrentPieceInfo } from '@/game/core/pieceInfo';

defineProps<{ info: CurrentPieceInfo | null }>();
</script>

<template>
  <section v-if="info" class="panel current-piece" aria-label="当前下落方块">
    <header>
      <h2>当前方块</h2>
      <span class="live">下落中</span>
    </header>

    <div class="body">
      <div
        class="glyph"
        :style="{ '--w': info.width, '--h': info.height, '--piece-color': info.color }"
      >
        <i
          v-for="(c, i) in info.cells"
          :key="i"
          :style="{ gridColumn: c.x + 1, gridRow: c.y + 1 }"
        ></i>
        <span
          v-if="info.arrow !== undefined"
          class="arrow"
          :style="{ '--rot': info.arrow * 90 + 'deg' }"
          aria-hidden="true"
        ><i></i></span>
      </div>

      <div class="id">
        <h3>{{ info.name }}</h3>
        <div class="tags">
          <span class="role">{{ info.role }}</span>
          <span v-if="info.rotatable" class="rot">↻ 可旋转</span>
        </div>
        <p class="meta">
          {{ info.width }}×{{ info.height }} · {{ info.cellCount }} 格
          <span v-if="info.direction" class="dir">方向 {{ info.direction }}</span>
        </p>
      </div>
    </div>

    <p class="summary">{{ info.summary }}</p>
    <p class="detail">{{ info.detail }}</p>
    <p class="caution">⚠ {{ info.caution }}</p>
  </section>
</template>

<style scoped>
.current-piece {
  min-width: 0;
}
.current-piece header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
}
.live {
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  color: #7fe9ff;
}
.body {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}
.glyph {
  position: relative;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(var(--w), 0.78rem);
  grid-template-rows: repeat(var(--h), 0.78rem);
  gap: 1.5px;
  padding: 0.3rem;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(120, 190, 230, 0.16);
}
.glyph i {
  width: 0.78rem;
  height: 0.78rem;
  border-radius: 2px;
  background: var(--piece-color, #7fe9ff);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.arrow {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transform: rotate(var(--rot));
  pointer-events: none;
  z-index: 1;
}
.arrow i {
  width: 74%;
  height: 74%;
  background: #0b1720;
  clip-path: polygon(50% 0%, 100% 55%, 66% 55%, 66% 100%, 34% 100%, 34% 55%, 0% 55%);
  box-shadow: none;
}
.id {
  min-width: 0;
}
.id h3 {
  margin: 0 0 0.2rem;
  font-size: 0.82rem;
  font-weight: 650;
  color: #e3f0f8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tags {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.role {
  padding: 0.04rem 0.34rem;
  border-radius: 999px;
  font-size: 0.58rem;
  color: #ffc274;
  background: rgba(255, 183, 94, 0.14);
  border: 1px solid rgba(255, 183, 94, 0.3);
}
.rot {
  font-size: 0.58rem;
  color: #8fa9bd;
}
.meta {
  margin: 0.24rem 0 0;
  font-size: 0.62rem;
  color: #8fa9bd;
  font-variant-numeric: tabular-nums;
}
.dir {
  margin-left: 0.32rem;
  color: #7fe9ff;
}
.summary {
  margin: 0 0 0.3rem;
  font-size: 0.68rem;
  line-height: 1.55;
  color: #cfe4f1;
}
.detail {
  margin: 0 0 0.3rem;
  font-size: 0.64rem;
  line-height: 1.55;
  color: #8fa9bd;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.caution {
  margin: 0;
  font-size: 0.62rem;
  line-height: 1.5;
  color: #c9a463;
}
/* Phones: one compact strip instead of a tall card. The full detail stays in
   the main-menu codex; here the player needs the name and the footprint. */
@media (max-width: 900px) and (orientation: portrait) {
  .current-piece header {
    display: none;
  }
  .current-piece .body {
    display: inline-flex;
    margin: 0;
    vertical-align: middle;
  }
  .glyph {
    grid-template-columns: repeat(var(--w), 0.55rem);
    grid-template-rows: repeat(var(--h), 0.55rem);
    padding: 0.2rem;
  }
  .glyph i {
    width: 0.55rem;
    height: 0.55rem;
  }
  .id h3 {
    font-size: 0.74rem;
  }
  .summary {
    display: inline;
    margin: 0 0 0 0.5rem;
    font-size: 0.62rem;
  }
  .detail,
  .caution {
    display: none;
  }
}
</style>
