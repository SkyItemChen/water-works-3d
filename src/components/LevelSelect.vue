<script setup lang="ts">
/**
 * LevelSelect — 60 contract levels, ten per page, sequentially unlocked.
 *
 * Existing saves may contain non-linear clears (from before the unlock rule);
 * their stars are preserved but a level still needs the immediately previous
 * one cleared, so the campaign always has one clear next step.
 */
import { computed, ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useProgressStore } from '@/stores/progressStore';
import {
  campaignPageCount,
  campaignPageForIndex,
  campaignPageSlice,
  clampCampaignPage,
  isLevelUnlocked,
  LEVELS_PER_PAGE,
} from '@/game/core/campaign';

const store = useGameStore();
const progress = useProgressStore();
const hovered = ref<string | null>(null);
const lockedHint = ref('');

const levels = computed(() => store.levels);
const totalStars = computed(() => progress.totalStars);
const totalScore = computed(() => progress.totalScore);
const totalScoreText = computed(() => totalScore.value.toLocaleString('en-US'));
const maxStars = computed(() => levels.value.length * 3);
const pages = computed(() => campaignPageCount(levels.value.length));

const firstUnfinished = levels.value.find((l) => !cleared(l.id));
const page = ref(campaignPageForIndex(firstUnfinished?.index ?? levels.value.at(-1)?.index ?? 1));
const pageLevels = computed(() => campaignPageSlice(levels.value, page.value));

function starsOf(id: string): number {
  return progress.levelRecords[id]?.stars ?? 0;
}
function cleared(id: string): boolean {
  return progress.levelRecords[id]?.cleared ?? false;
}
function best(id: string): number {
  return progress.levelRecords[id]?.bestScore ?? 0;
}
function clearedIndex(index: number): boolean {
  const level = levels.value.find((l) => l.index === index);
  return level ? cleared(level.id) : false;
}
function unlocked(level: { index: number }): boolean {
  return isLevelUnlocked(level.index, clearedIndex);
}
function play(level: { id: string; index: number }): void {
  if (!unlocked(level)) {
    lockedHint.value = `通过第 ${level.index - 1} 关后解锁第 ${level.index} 关`;
    return;
  }
  lockedHint.value = '';
  store.startLevel(level.id);
}
function goPage(next: number): void {
  page.value = clampCampaignPage(next, levels.value.length);
  lockedHint.value = '';
}
function rangeLabel(p: number): string {
  const start = (p - 1) * LEVELS_PER_PAGE + 1;
  const end = Math.min(p * LEVELS_PER_PAGE, levels.value.length);
  return `${start}–${end}`;
}
function pageCleared(p: number): number {
  return campaignPageSlice(levels.value, p).filter((l) => cleared(l.id)).length;
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
        <p>{{ levels.length }} 份合同 · 每 {{ LEVELS_PER_PAGE }} 关一页 · 通过上一关解锁下一关</p>
      </div>
      <div class="head-stats">
        <div class="star-total" title="总星数">
          <span>★</span>
          <b>{{ totalStars }}</b>
          <em>/ {{ maxStars }}</em>
        </div>
        <div class="score-total" title="累计总分">
          <span>总分</span>
          <b>{{ totalScoreText }}</b>
        </div>
      </div>
    </header>

    <nav class="pager" aria-label="合同分页">
      <button class="page-arrow" :disabled="page === 1" aria-label="上一页" @click="goPage(page - 1)">←</button>
      <button
        v-for="p in pages"
        :key="p"
        class="page-tab"
        :class="{ on: page === p, complete: pageCleared(p) === Math.min(LEVELS_PER_PAGE, levels.length - (p - 1) * LEVELS_PER_PAGE) }"
        :aria-current="page === p ? 'page' : undefined"
        @click="goPage(p)"
      >
        <b>{{ p }}</b>
        <span>{{ rangeLabel(p) }} · {{ pageCleared(p) }}/{{ Math.min(LEVELS_PER_PAGE, levels.length - (p - 1) * LEVELS_PER_PAGE) }}</span>
      </button>
      <button class="page-arrow" :disabled="page === pages" aria-label="下一页" @click="goPage(page + 1)">→</button>
    </nav>

    <Transition name="hint">
      <p v-if="lockedHint" class="locked-hint">🔒 {{ lockedHint }}</p>
    </Transition>

    <div class="grid">
      <button
        v-for="l in pageLevels"
        :key="l.id"
        class="level-card"
        :class="{ cleared: cleared(l.id), locked: !unlocked(l), hovered: hovered === l.id }"
        :aria-disabled="!unlocked(l)"
        @mouseenter="hovered = l.id"
        @mouseleave="hovered = null"
        @click="play(l)"
      >
        <div class="card-top">
          <span class="num">{{ String(l.index).padStart(2, '0') }}</span>
          <span v-if="unlocked(l)" class="stars">
            <i v-for="n in 3" :key="n" :class="{ on: starsOf(l.id) >= n }">★</i>
          </span>
          <span v-else class="lock-mark">🔒</span>
        </div>
        <h2>{{ l.name }}</h2>
        <p class="mech">{{ l.mechanic }}</p>
        <p class="intro">{{ l.intro }}</p>
        <div class="meta">
          <span>{{ l.blockLimit }} 块</span>
          <span>{{ l.drains.length }} 排水口</span>
          <span v-if="best(l.id) > 0" class="best">最佳 {{ best(l.id) }}</span>
        </div>
        <p v-if="!unlocked(l)" class="locked-note">通过第 {{ l.index - 1 }} 关后解锁</p>
        <div class="stripe"></div>
      </button>
    </div>

    <button class="endless" @click="store.startEndless()">
      <span class="endless-icon">∞</span>
      <span class="endless-copy">
        <b>无尽水厂</b>
        <em>水位持续上涨，追一个更高的分数。</em>
      </span>
      <span class="endless-best">最高分 {{ progress.data.endlessBest }}</span>
    </button>
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
  margin-bottom: 1rem;
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
.head-stats {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.score-total {
  display: flex;
  align-items: baseline;
  gap: 0.2rem;
  background: rgba(127, 233, 255, 0.08);
  border: 1px solid rgba(127, 233, 255, 0.24);
  border-radius: 10px;
  padding: 0.45rem 0.7rem;
}
.score-total span {
  color: #7fe9ff;
  font-size: 0.76rem;
}
.score-total b {
  color: #7fe9ff;
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
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
.pager {
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
  margin-bottom: 0.85rem;
  overflow-x: auto;
  padding-bottom: 0.15rem;
}
.page-arrow,
.page-tab {
  flex: 0 0 auto;
  border: 1px solid rgba(120, 190, 230, 0.16);
  background: rgba(255, 255, 255, 0.035);
  color: #9fb8c9;
  border-radius: 9px;
  cursor: pointer;
}
.page-arrow {
  width: 2.1rem;
  font-size: 0.95rem;
}
.page-arrow:disabled {
  opacity: 0.3;
  cursor: default;
}
.page-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.05rem;
  padding: 0.36rem 0.65rem;
  min-width: 5.4rem;
  transition: 0.15s ease;
}
.page-tab b {
  font-size: 0.78rem;
  color: #cfe4f2;
}
.page-tab span {
  font-size: 0.56rem;
  color: #6d8394;
  font-variant-numeric: tabular-nums;
}
.page-tab:hover,
.page-arrow:not(:disabled):hover {
  border-color: rgba(127, 233, 255, 0.4);
}
.page-tab.on {
  border-color: rgba(127, 233, 255, 0.55);
  background: rgba(127, 233, 255, 0.1);
}
.page-tab.on b {
  color: #9be8ff;
}
.page-tab.complete span {
  color: #6ee7a0;
}
.locked-hint {
  margin: 0 0 0.7rem;
  padding: 0.45rem 0.7rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 183, 94, 0.3);
  background: rgba(255, 183, 94, 0.08);
  color: #ffd28a;
  font-size: 0.72rem;
}
.hint-enter-active,
.hint-leave-active {
  transition: opacity 0.16s ease;
}
.hint-enter-from,
.hint-leave-to {
  opacity: 0;
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
.level-card.locked {
  cursor: not-allowed;
  opacity: 0.56;
  filter: saturate(0.55);
}
.level-card.locked:hover {
  transform: none;
  border-color: rgba(120, 190, 230, 0.16);
  box-shadow: none;
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
.lock-mark {
  font-size: 0.8rem;
  opacity: 0.8;
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
.locked-note {
  margin: 0.45rem 0 0;
  padding-top: 0.35rem;
  border-top: 1px dashed rgba(255, 183, 94, 0.16);
  color: #c99b5e;
  font-size: 0.62rem;
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
.endless {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  margin-top: 0.9rem;
  padding: 0.8rem 1rem;
  text-align: left;
  border-radius: 13px;
  border: 1px solid rgba(255, 183, 94, 0.28);
  background: linear-gradient(160deg, rgba(46, 33, 24, 0.95), rgba(15, 12, 10, 0.95));
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.endless:hover {
  border-color: rgba(255, 183, 94, 0.55);
}
.endless-icon {
  font-size: 1.6rem;
  color: #ffb75e;
  line-height: 1;
}
.endless-copy {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.endless-copy b {
  font-size: 0.86rem;
}
.endless-copy em {
  color: #8fa9bd;
  font-style: normal;
  font-size: 0.66rem;
}
.endless-best {
  margin-left: auto;
  color: #ffd28a;
  font-size: 0.68rem;
  white-space: nowrap;
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
  .head-stats {
    order: 0;
  }
  .page-tab {
    min-width: 4.8rem;
  }
}
</style>
