<script setup lang="ts">
/**
 * DailyChallenge — today's seeded run, local leaderboard, share entry, replay
 * import. All local; no network calls.
 */
import { computed, ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useProgressStore } from '@/stores/progressStore';
import { dateSeed, daysAgo, todayKey } from '@/game/core/daily';
import ShareCodePanel from './ShareCodePanel.vue';

const store = useGameStore();
const progress = useProgressStore();
const tab = ref<'today' | 'board' | 'replay'>('today');
const codeInput = ref('');
const codeError = ref('');
const viewedDate = ref(todayKey());

const today = computed(() => todayKey());
const board = computed(() => progress.dailyBoard(viewedDate.value));
const best = computed(() => board.value[0] ?? null);
const seed = computed(() => dateSeed(`daily:${viewedDate.value}`));

const last7 = computed(() => {
  const days: { key: string; best: number | null; played: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const key = daysAgo(i);
    const b = progress.dailyBest(key);
    days.push({ key, best: b ? b.score : null, played: !!b });
  }
  return days;
});

function play(): void {
  store.startDaily(today.value);
}

function back(): void {
  store.toMenu();
}

function importReplay(): void {
  codeError.value = '';
  const res = store.loadReplayCode(codeInput.value);
  if (!res.ok) codeError.value = res.error ?? '短码无效';
}
</script>

<template>
  <div class="daily">
    <header class="head">
      <button class="back" @click="back">← 返回</button>
      <div>
        <span class="kicker">每日挑战</span>
        <h1>{{ today }}</h1>
        <p>日期种子 <code>{{ seed }}</code> · 全球同一块序 · 本地排行榜</p>
      </div>
      <div class="streak">
        <span>最近 7 天</span>
        <div class="days">
          <i v-for="d in last7" :key="d.key" :class="{ played: d.played }" :title="d.key"></i>
        </div>
      </div>
    </header>

    <nav class="tabs">
      <button :class="{ on: tab === 'today' }" @click="tab = 'today'">今日挑战</button>
      <button :class="{ on: tab === 'board' }" @click="tab = 'board'">本地排行榜</button>
      <button :class="{ on: tab === 'replay' }" @click="tab = 'replay'">输入分享码</button>
    </nav>

    <section v-if="tab === 'today'" class="panel play-panel">
      <div class="hero">
        <div class="drop" aria-hidden="true">💧</div>
        <div>
          <h2>今天的井道</h2>
          <p>
            固定种子、固定 7-bag 序列。目标：向清水口排出 14 单位清水，并让水位保持在安全线以下。
            离线也能玩，成绩记录在本机。
          </p>
          <button class="primary big" @click="play">开始今日挑战</button>
        </div>
      </div>
      <div class="info-grid">
        <div><span>今日最佳</span><b>{{ best ? best.score : '—' }}</b></div>
        <div><span>最佳块数</span><b>{{ best ? best.blocks : '—' }}</b></div>
        <div><span>尝试次数</span><b>{{ progress.dailyBoard(today).length }}</b></div>
        <div><span>块数上限</span><b>18</b></div>
      </div>
    </section>

    <section v-else-if="tab === 'board'" class="panel">
      <div class="board-head">
        <h2>本地排行榜</h2>
        <input type="date" v-model="viewedDate" class="date" />
      </div>
      <p class="note">记录在这台设备上。排序：通关优先 → 分数 → 更少块数。</p>
      <ol v-if="board.length" class="board-list">
        <li v-for="(e, i) in board" :key="i" :class="{ top: i === 0 }">
          <span class="rank">{{ i + 1 }}</span>
          <span class="score">{{ e.score }}</span>
          <span class="blocks">{{ e.blocks }} 块</span>
          <span class="tag" :class="{ won: e.won }">{{ e.won ? '通关' : '未完成' }}</span>
          <span class="time">{{ new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</span>
        </li>
      </ol>
      <p v-else class="empty">这一天还没有记录。去玩一局吧。</p>
    </section>

    <section v-else class="panel">
      <h2>输入解法短码</h2>
      <p class="note">所有回放都在本地重跑，不会上传任何数据。</p>
      <ShareCodePanel @loaded="codeError = ''" />
      <div class="manual">
        <input v-model="codeInput" placeholder="WW3-XXXX..." spellcheck="false" />
        <button class="primary" @click="importReplay">回放</button>
      </div>
      <p v-if="codeError" class="err">{{ codeError }}</p>
    </section>
  </div>
</template>

<style scoped>
.daily {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 1.4rem clamp(1rem, 4vw, 3rem) 3rem;
  background: radial-gradient(circle at 80% 0%, rgba(255, 183, 94, 0.14), transparent 45%), #080d12;
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
}
.kicker {
  font-size: 0.64rem;
  letter-spacing: 0.18em;
  color: #ffb75e;
  text-transform: uppercase;
}
h1 {
  margin: 0.15rem 0 0.2rem;
  font-size: 1.6rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.head p {
  margin: 0;
  color: #8fa9bd;
  font-size: 0.76rem;
}
code {
  color: #9be8ff;
  font-size: 0.72rem;
}
.streak {
  text-align: right;
  font-size: 0.66rem;
  color: #7d94a5;
}
.days {
  display: flex;
  gap: 0.22rem;
  margin-top: 0.3rem;
  justify-content: flex-end;
}
.days i {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
}
.days i.played {
  background: #ffb75e;
  box-shadow: 0 0 8px rgba(255, 183, 94, 0.4);
}
.tabs {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.tabs button {
  padding: 0.42rem 0.8rem;
  border-radius: 999px;
  border: 1px solid rgba(120, 190, 230, 0.18);
  background: transparent;
  color: #8fa9bd;
  font-size: 0.76rem;
  cursor: pointer;
}
.tabs button.on {
  background: rgba(127, 233, 255, 0.12);
  color: #9be8ff;
  border-color: rgba(127, 233, 255, 0.4);
}
.panel {
  background: linear-gradient(160deg, rgba(20, 34, 46, 0.9), rgba(10, 17, 24, 0.9));
  border: 1px solid rgba(120, 190, 230, 0.16);
  border-radius: 16px;
  padding: 1.2rem 1.3rem;
  max-width: 780px;
}
.hero {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1.1rem;
}
.drop {
  font-size: 2.4rem;
  filter: drop-shadow(0 0 18px rgba(95, 214, 255, 0.6));
}
.hero h2 {
  margin: 0 0 0.3rem;
  font-size: 1.15rem;
}
.hero p {
  margin: 0 0 0.8rem;
  font-size: 0.8rem;
  line-height: 1.6;
  color: #9fb8c9;
}
button.primary {
  padding: 0.6rem 1.1rem;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #2a9dc4, #1a6f96);
  color: #eafaff;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
}
button.big {
  padding: 0.75rem 1.4rem;
  font-size: 0.92rem;
  box-shadow: 0 8px 24px rgba(42, 157, 196, 0.35);
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
}
.info-grid div {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(120, 190, 230, 0.1);
  border-radius: 10px;
  padding: 0.5rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.info-grid span {
  font-size: 0.62rem;
  color: #7d94a5;
}
.info-grid b {
  font-size: 1.05rem;
  color: #ffd28a;
}
.board-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
h2 {
  margin: 0 0 0.3rem;
  font-size: 1.05rem;
}
.date {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(120, 190, 230, 0.2);
  border-radius: 8px;
  color: #d7e7f2;
  padding: 0.35rem 0.5rem;
  font-size: 0.74rem;
}
.note {
  margin: 0 0 0.8rem;
  font-size: 0.7rem;
  color: #7d94a5;
}
.board-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}
.board-list li {
  display: grid;
  grid-template-columns: 1.6rem 4rem 1fr 1fr auto;
  gap: 0.6rem;
  align-items: center;
  padding: 0.45rem 0.6rem;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 0.76rem;
}
.board-list li.top {
  background: rgba(255, 209, 102, 0.1);
  border: 1px solid rgba(255, 209, 102, 0.3);
}
.rank {
  color: #7d94a5;
  font-variant-numeric: tabular-nums;
}
.score {
  color: #ffd28a;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.blocks {
  color: #9fb8c9;
}
.tag {
  font-size: 0.64rem;
  color: #ff9ba3;
}
.tag.won {
  color: #8ef0b6;
}
.time {
  color: #6d8394;
  font-size: 0.66rem;
}
.empty {
  color: #7d94a5;
  font-size: 0.8rem;
}
.manual {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.9rem;
}
.manual input {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 9px;
  padding: 0.5rem 0.7rem;
  color: #cdefff;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.76rem;
}
.err {
  color: #ff9ba3;
  font-size: 0.72rem;
}
@media (max-width: 700px) {
  .head {
    grid-template-columns: 1fr auto;
  }
  .head > div:nth-child(2) {
    grid-column: 1 / -1;
    order: 2;
  }
  .info-grid {
    grid-template-columns: 1fr 1fr;
  }
  .board-list li {
    grid-template-columns: 1.4rem 3rem 1fr auto;
  }
  .board-list .time {
    display: none;
  }
}
</style>
