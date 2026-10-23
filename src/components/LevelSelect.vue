<script setup lang="ts">
/**
 * LevelSelect — 30 contract levels (schema supports 60), star tracking and
 * best-score display from localStorage.
 */
import { computed, ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useProgressStore } from '@/stores/progressStore';

const store = useGameStore();
const progress = useProgressStore();
const hovered = ref<string | null>(null);

const levels = computed(() => store.levels);
const totalStars = computed(() => progress.totalStars);
const maxStars = computed(() => levels.value.length * 3);

function starsOf(id: string): number {
  return progress.levelRecords[id]?.stars ?? 0;
}
function cleared(id: string): boolean {
  return progress.levelRecords[id]?.cleared ?? false;
}
function best(id: string): number {
  return progress.levelRecords[id]?.bestScore ?? 0;
}

function play(id: string): void {
  store.startLevel(id);
}

function back(): void {
  store.toMenu();
}
</script>

<template>
  <div class="level-select">
    <header class="head">
      <button class="back" @click="back">← 返回</button>
      <div class="title">
        <span class="kicker">合同模式</span>
        <h1>水厂委托</h1>
        <p>30 份合同，每 5 关引入一个新机制，末尾是组合考核与总验收。</p>
      </div>
      <div class="star-total">
        <span>★</span>
        <b>{{ totalStars }}</b>
        <em>/ {{ maxStars }}</em>
      </div>
    </header>

    <div class="grid">
      <button
        v-for="l in levels"
        :key="l.id"
        class="level-card"
        :class="{ cleared: cleared(l.id), hovered: hovered === l.id }"
        @mouseenter="hovered = l.id"
        @mouseleave="hovered = null"
        @click="play(l.id)"
      >
        <div class="card-top">
          <span class="num">{{ String(l.index).padStart(2, '0') }}</span>
          <span class="stars">
            <i v-for="n in 3" :key="n" :class="{ on: starsOf(l.id) >= n }">★</i>
          </span>
        </div>
        <h2>{{ l.name }}</h2>
        <p class="mech">{{ l.mechanic }}</p>
        <p class="intro">{{ l.intro }}</p>
        <div class="meta">
          <span>{{ l.blockLimit }} 块</span>
          <span>{{ l.drains.length }} 排水口</span>
          <span v-if="best(l.id) > 0" class="best">最佳 {{ best(l.id) }}</span>
        </div>
        <div class="stripe"></div>
      </button>

      <button class="level-card bonus" @click="store.startEndless()">
        <div class="card-top">
          <span class="num">∞</span>
          <span class="stars"><i v-for="n in 3" :key="n" :class="{ on: progress.data.endlessBest > 0 }">★</i></span>
        </div>
        <h2>无尽水厂</h2>
        <p class="mech">水位持续上涨</p>
        <p class="intro">没有合同，只有更久。水位会随时间上涨，尽可能多排水。</p>
        <div class="meta">
          <span>最高分 {{ progress.data.endlessBest }}</span>
        </div>
        <div class="stripe"></div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.level-select {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 1.4rem clamp(1rem, 4vw, 3rem) 3rem;
  background: radial-gradient(circle at 20% 0%, rgba(42, 157, 196, 0.18), transparent 45%),
    radial-gradient(circle at 90% 100%, rgba(255, 183, 94, 0.12), transparent 45%), #080d12;
  color: #e9f2f8;
  z-index: 30;
}
.head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: start;
  margin-bottom: 1.4rem;
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
}
.back:hover {
  border-color: rgba(127, 233, 255, 0.5);
}
.kicker {
  font-size: 0.64rem;
  letter-spacing: 0.18em;
  color: #ffb75e;
  text-transform: uppercase;
}
h1 {
  margin: 0.15rem 0 0.25rem;
  font-size: 1.7rem;
  letter-spacing: 0.01em;
}
.title p {
  margin: 0;
  color: #8fa9bd;
  font-size: 0.8rem;
}
.star-total {
  display: flex;
  align-items: baseline;
  gap: 0.2rem;
  background: rgba(255, 209, 102, 0.08);
  border: 1px solid rgba(255, 209, 102, 0.24);
  border-radius: 10px;
  padding: 0.45rem 0.7rem;
}
.star-total span {
  color: #ffd166;
}
.star-total b {
  color: #ffd166;
  font-size: 1.1rem;
}
.star-total em {
  color: #8a7a55;
  font-style: normal;
  font-size: 0.72rem;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 0.9rem;
}
.level-card {
  position: relative;
  text-align: left;
  padding: 0.9rem 1rem 1rem;
  border-radius: 14px;
  border: 1px solid rgba(120, 190, 230, 0.16);
  background: linear-gradient(160deg, rgba(20, 34, 46, 0.95), rgba(11, 19, 26, 0.95));
  color: inherit;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
  font: inherit;
}
.level-card:hover {
  transform: translateY(-3px);
  border-color: rgba(127, 233, 255, 0.45);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
}
.level-card.cleared {
  border-color: rgba(110, 231, 160, 0.28);
}
.level-card.bonus {
  background: linear-gradient(160deg, rgba(46, 33, 24, 0.95), rgba(15, 12, 10, 0.95));
  border-color: rgba(255, 183, 94, 0.28);
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.4rem;
}
.num {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.72rem;
  color: #7fa6bf;
  letter-spacing: 0.1em;
}
.stars {
  display: flex;
  gap: 0.1rem;
}
.stars i {
  font-style: normal;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.12);
}
.stars i.on {
  color: #ffd166;
  text-shadow: 0 0 8px rgba(255, 209, 102, 0.55);
}
h2 {
  margin: 0 0 0.15rem;
  font-size: 1rem;
  font-weight: 650;
}
.mech {
  margin: 0 0 0.4rem;
  font-size: 0.66rem;
  color: #6fc7e8;
}
.intro {
  margin: 0 0 0.6rem;
  font-size: 0.7rem;
  line-height: 1.5;
  color: #8fa9bd;
  min-height: 2.9em;
}
.meta {
  display: flex;
  gap: 0.55rem;
  font-size: 0.62rem;
  color: #6d8394;
  flex-wrap: wrap;
}
.meta .best {
  color: #ffd28a;
}
.stripe {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(127, 233, 255, 0.6), transparent);
  opacity: 0;
  transition: opacity 0.18s ease;
}
.level-card:hover .stripe {
  opacity: 1;
}
@media (max-width: 640px) {
  .head {
    grid-template-columns: 1fr auto;
  }
  .head .title {
    grid-column: 1 / -1;
    order: 2;
  }
  .back {
    order: 1;
  }
  .star-total {
    order: 0;
  }
}
</style>
