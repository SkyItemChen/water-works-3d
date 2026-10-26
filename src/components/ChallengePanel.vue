<script setup lang="ts">
/**
 * ChallengePanel — every campaign level again, with the solver's best score as
 * the bar. All 60 are open from the start; there is no unlock chain, the point
 * is "can you reach the number".
 */
import { computed, ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useProgressStore } from '@/stores/progressStore';
import { CHALLENGE_ENTRIES, challengePace } from '@/game/core/challenge';
import { campaignPageCount, campaignPageSlice, clampCampaignPage } from '@/game/core/campaign';

const store = useGameStore();
const progress = useProgressStore();

const page = ref(1);
const pageCount = campaignPageCount(CHALLENGE_ENTRIES.length);
/** At least one level only has a tick-0 line: say so once, on every page. */
const hasMachinePace = CHALLENGE_ENTRIES.some((e) => challengePace(e.id) === 'machine');

const rows = computed(() =>
  campaignPageSlice(CHALLENGE_ENTRIES, page.value).map((entry) => {
    const rec = progress.challengeRecords[entry.id];
    return {
      entry,
      level: store.levels.find((l) => l.id === entry.id),
      cleared: !!rec?.cleared,
      conceded: !!rec?.conceded,
      best: rec?.bestScore ?? 0,
      attempts: rec?.attempts ?? 0,
      machine: challengePace(entry.id) === 'machine',
    };
  }),
);

function turnPage(delta: number): void {
  page.value = clampCampaignPage(page.value + delta, CHALLENGE_ENTRIES.length);
}

function back(): void {
  store.toMenu();
}

function play(id: string): void {
  store.startChallenge(id);
}
</script>

<template>
  <div class="challenge-page">
    <div class="bg" aria-hidden="true">
      <div class="glow"></div>
      <div class="grid-lines"></div>
    </div>

    <div class="content">
      <header class="page-head">
        <button class="back" @click="back">← 返回</button>
        <div class="title">
          <span class="kicker">挑战模式</span>
          <h1>最优解挑战</h1>
          <p>
            60 关全部开放。过关条件不是「完成合同」，而是打到离线求解器算出的**人类可复现**最高分——差一分都算没通过。
          </p>
        </div>
        <div class="scoreboard">
          <div><span>通过</span><b>{{ progress.challengeClearedCount }}/{{ progress.challengeTotal }}</b></div>
          <div><span>认输</span><b class="warn">{{ progress.challengeConcededCount }}</b></div>
          <div><span>连续不认输</span><b>{{ progress.data.challengeStreak }}</b></div>
        </div>
      </header>

      <p class="hint">
        目标分全部按「逐块实时下落」的节奏算出，照着官方回放的方向调整就能复现。卡住了可以在结算弹窗点「认输」，
        会直接给出这一关的官方回放码并记录一次认输——自己打过去才算真通过。
        <template v-if="hasMachinePace">
          标注「机器线」的关卡目前只找到 tick 0 连锁硬降的解（引擎合法、人类手速无法复现），它的目标分仅作参考。
        </template>
      </p>

      <section class="grid" aria-label="挑战关卡">
        <article
          v-for="row in rows"
          :key="row.entry.id"
          class="card"
          :class="{ done: row.cleared, conceded: row.conceded && !row.cleared }"
        >
          <header>
            <span class="no">{{ String(row.entry.index).padStart(2, '0') }}</span>
            <span class="name">{{ row.level?.name ?? row.entry.id }}</span>
            <span v-if="row.machine" class="tag machine">机器线</span>
            <span v-if="row.cleared" class="tag ok">已通过</span>
            <span v-else-if="row.conceded" class="tag warn">已认输</span>
          </header>
          <div class="meta">
            <div><span>目标分</span><b class="target">{{ row.entry.target }}</b></div>
            <div><span>我的最好</span><b>{{ row.best || '—' }}</b></div>
            <div><span>尝试</span><b>{{ row.attempts }}</b></div>
          </div>
          <button class="play" @click="play(row.entry.id)">{{ row.cleared ? '再挑战' : '开打' }}</button>
        </article>
      </section>

      <nav class="pager" aria-label="分页">
        <button :disabled="page <= 1" @click="turnPage(-1)">←</button>
        <span>第 {{ page }} / {{ pageCount }} 页</span>
        <button :disabled="page >= pageCount" @click="turnPage(1)">→</button>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.challenge-page {
  position: absolute;
  inset: 0;
  z-index: 30;
  overflow-y: auto;
  color: #e9f2f8;
  background: radial-gradient(circle at 12% 0%, rgba(126, 226, 168, 0.18), transparent 46%),
    radial-gradient(circle at 92% 100%, rgba(42, 157, 196, 0.12), transparent 44%), #080d12;
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
  left: 6%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(126, 226, 168, 0.3), transparent 70%);
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
  margin-bottom: 1rem;
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
  color: #6fbfa0;
}
h1 {
  margin: 0.15rem 0 0.3rem;
  font-size: 1.5rem;
}
.title p {
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.6;
  color: #8fa9bd;
  max-width: 52ch;
}
.scoreboard {
  display: flex;
  gap: 1rem;
  text-align: right;
}
.scoreboard div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.scoreboard span {
  font-size: 0.6rem;
  color: #6d8394;
  letter-spacing: 0.08em;
}
.scoreboard b {
  font-size: 0.95rem;
  color: #cdefff;
}
.scoreboard b.warn {
  color: #ffc274;
}
.hint {
  margin: 0 0 1rem;
  font-size: 0.72rem;
  line-height: 1.6;
  color: #7f97a8;
  border-left: 2px solid rgba(255, 183, 94, 0.4);
  padding-left: 0.6rem;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0.7rem;
}
.card {
  border: 1px solid rgba(120, 190, 230, 0.16);
  border-radius: 14px;
  padding: 0.8rem 0.9rem;
  background: linear-gradient(160deg, rgba(21, 36, 49, 0.9), rgba(10, 17, 24, 0.9));
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.card.done {
  border-color: rgba(110, 231, 160, 0.38);
  background: linear-gradient(160deg, rgba(24, 48, 40, 0.9), rgba(10, 20, 16, 0.9));
}
.card.conceded {
  border-color: rgba(255, 183, 94, 0.3);
  background: linear-gradient(160deg, rgba(46, 36, 22, 0.9), rgba(18, 13, 8, 0.9));
}
.card header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.no {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.7rem;
  color: #7fa6bf;
}
.name {
  font-size: 0.88rem;
  font-weight: 600;
}
.tag {
  margin-left: auto;
  font-size: 0.58rem;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  border: 1px solid rgba(120, 190, 230, 0.24);
  color: #8fa9bd;
}
.tag.ok {
  color: #8ef0b6;
  border-color: rgba(110, 231, 160, 0.45);
  background: rgba(110, 231, 160, 0.12);
}
.tag.warn {
  color: #ffc274;
  border-color: rgba(255, 183, 94, 0.45);
  background: rgba(255, 183, 94, 0.12);
}
.tag.machine {
  color: #c3b6ff;
  border-color: rgba(163, 148, 255, 0.45);
  background: rgba(163, 148, 255, 0.12);
}
.meta {
  display: flex;
  gap: 1rem;
  font-size: 0.66rem;
  color: #7f97a8;
}
.meta div {
  display: flex;
  flex-direction: column;
}
.meta b {
  font-size: 0.85rem;
  color: #d7e7f2;
}
.meta b.target {
  color: #7fe9ff;
}
.play {
  margin-top: auto;
  padding: 0.42rem;
  border-radius: 9px;
  border: 1px solid rgba(127, 233, 255, 0.35);
  background: rgba(127, 233, 255, 0.12);
  color: #d9f7ff;
  font-size: 0.76rem;
  cursor: pointer;
  transition: 0.15s ease;
}
.play:hover {
  background: rgba(127, 233, 255, 0.2);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  margin-top: 1.2rem;
  font-size: 0.72rem;
  color: #8fa9bd;
}
.pager button {
  padding: 0.3rem 0.7rem;
  border-radius: 8px;
  border: 1px solid rgba(120, 190, 230, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: #cfe4f2;
  cursor: pointer;
}
.pager button:disabled {
  opacity: 0.35;
  cursor: default;
}
@media (max-width: 720px) {
  .page-head {
    grid-template-columns: auto 1fr;
  }
  .scoreboard {
    grid-column: 1 / -1;
    justify-content: space-between;
    text-align: left;
  }
}
</style>
