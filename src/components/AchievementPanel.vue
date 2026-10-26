<script setup lang="ts">
/**
 * AchievementPanel — the full list, locked ones included, with live progress so
 * a player can see what is still reachable rather than guessing.
 */
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useProgressStore } from '@/stores/progressStore';
import { achievementProgress } from '@/game/core/achievements';

const store = useGameStore();
const progress = useProgressStore();

const stats = computed(() => progress.achievementStats);

const rows = computed(() =>
  progress.achievementList.map(({ def, unlockedAt }) => ({
    def,
    unlockedAt,
    progress: achievementProgress(def.id, stats.value),
  })),
);

const done = computed(() => rows.value.filter((r) => r.unlockedAt > 0).length);

function back(): void {
  store.toMenu();
}

function stamp(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="ach-page">
    <div class="bg" aria-hidden="true">
      <div class="glow"></div>
      <div class="grid-lines"></div>
    </div>

    <div class="content">
      <header class="page-head">
        <button class="back" @click="back">← 返回</button>
        <div class="title">
          <span class="kicker">成就</span>
          <h1>水厂履历</h1>
          <p>合同、挑战、认输，全都被记在这张表上。</p>
        </div>
        <div class="counter">
          <b>{{ done }}</b>
          <span>/ {{ rows.length }}</span>
        </div>
      </header>

      <section class="grid" aria-label="成就列表">
        <article
          v-for="row in rows"
          :key="row.def.id"
          class="card"
          :class="[row.def.tier, { locked: !row.unlockedAt }]"
        >
          <div class="medal" aria-hidden="true">{{ row.unlockedAt ? '◆' : '◇' }}</div>
          <div class="body">
            <h2>
              {{ row.def.name }}
              <span v-if="row.unlockedAt" class="stamp">{{ stamp(row.unlockedAt) }}</span>
            </h2>
            <p>{{ row.def.desc }}</p>
            <div class="foot">
              <span class="tier">{{ row.def.tier.toUpperCase() }}</span>
              <span v-if="row.progress" class="prog">{{ row.progress }}</span>
            </div>
          </div>
        </article>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ach-page {
  position: absolute;
  inset: 0;
  z-index: 30;
  overflow-y: auto;
  color: #e9f2f8;
  background: radial-gradient(circle at 88% 0%, rgba(255, 183, 94, 0.14), transparent 44%),
    radial-gradient(circle at 8% 100%, rgba(42, 157, 196, 0.14), transparent 46%), #080d12;
}
.bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.glow {
  position: absolute;
  width: 600px;
  height: 600px;
  top: -260px;
  right: 6%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 183, 94, 0.3), transparent 70%);
  filter: blur(90px);
  opacity: 0.42;
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
  max-width: 1000px;
  margin: 0 auto;
  padding: 1.4rem clamp(1rem, 4vw, 3rem) 3rem;
}
.page-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1.2rem;
  padding-bottom: 1rem;
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
}
.back:hover {
  border-color: rgba(127, 233, 255, 0.5);
  color: #eafaff;
}
.kicker {
  display: block;
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #d8a75f;
}
h1 {
  margin: 0.15rem 0 0.3rem;
  font-size: 1.5rem;
}
.title p {
  margin: 0;
  font-size: 0.76rem;
  color: #8fa9bd;
}
.counter {
  display: flex;
  align-items: baseline;
  gap: 0.2rem;
}
.counter b {
  font-size: 1.5rem;
  color: #ffc274;
}
.counter span {
  font-size: 0.75rem;
  color: #6d8394;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.7rem;
}
.card {
  display: flex;
  gap: 0.7rem;
  padding: 0.8rem 0.9rem;
  border-radius: 14px;
  border: 1px solid rgba(120, 190, 230, 0.16);
  background: linear-gradient(160deg, rgba(21, 36, 49, 0.9), rgba(10, 17, 24, 0.9));
}
.card.locked {
  opacity: 0.55;
}
.card.bronze {
  border-color: rgba(198, 143, 96, 0.4);
}
.card.silver {
  border-color: rgba(178, 200, 214, 0.42);
}
.card.gold {
  border-color: rgba(255, 196, 106, 0.45);
}
.card.platinum {
  border-color: rgba(151, 234, 255, 0.45);
  box-shadow: 0 0 24px rgba(127, 233, 255, 0.08) inset;
}
.medal {
  font-size: 1.1rem;
  color: #ffc274;
  line-height: 1.2;
}
.card.locked .medal {
  color: #55697a;
}
.body {
  flex: 1;
  min-width: 0;
}
h2 {
  margin: 0 0 0.2rem;
  font-size: 0.9rem;
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.stamp {
  font-size: 0.58rem;
  color: #6d8394;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
p {
  margin: 0 0 0.4rem;
  font-size: 0.7rem;
  line-height: 1.55;
  color: #8fa9bd;
}
.foot {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  color: #6d8394;
}
.tier {
  text-transform: uppercase;
}
.prog {
  color: #9fc4d8;
}
@media (max-width: 720px) {
  .page-head {
    grid-template-columns: auto 1fr;
  }
  .counter {
    grid-column: 1 / -1;
  }
}
</style>
