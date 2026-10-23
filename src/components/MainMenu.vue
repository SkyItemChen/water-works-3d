<script setup lang="ts">
/**
 * MainMenu — title, tagline, mode entry points and local stats.
 */
import { computed, ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useProgressStore } from '@/stores/progressStore';
import { useTutorialStore } from '@/stores/tutorialStore';
import { todayKey } from '@/game/core/daily';
import BlockGuide from '@/components/BlockGuide.vue';

const store = useGameStore();
const progress = useProgressStore();
const tutorial = useTutorialStore();
const code = ref('');

const cleared = computed(() => progress.clearedCount);
const totalLevels = computed(() => store.levels.length);
const stars = computed(() => progress.totalStars);
const todayBest = computed(() => progress.dailyBest(todayKey()));
/** Missing field on old saves reads as "not seen", so the badge shows once. */
const tutorialIsNew = computed(() => progress.tutorialIsNew);

function playLatest(): void {
  // Jump to the first uncleared contract, else replay the last one.
  const next = store.levels.find((l) => !progress.levelRecords[l.id]?.cleared) ?? store.levels[store.levels.length - 1];
  if (next) store.startLevel(next.id);
}

function loadCode(): void {
  if (!code.value.trim()) return;
  store.loadReplayCode(code.value);
}
</script>

<template>
  <div class="menu">
    <div class="bg" aria-hidden="true">
      <div class="glow a"></div>
      <div class="glow b"></div>
      <div class="grid-lines"></div>
    </div>

    <div class="content">
      <div class="title-block">
        <span class="tag">Strategy · Puzzle · Relaxing</span>
        <h1>
          Waterworks
          <span class="three">3D</span>
        </h1>
        <p class="tagline">每一块都在决定水的命运</p>
        <p class="blurb">
          竖井里落下体素，清水与污水在你手里分流。100% 确定性的水模拟，同种子同操作结果完全一致——所以每一次通关都可以被回放、被分享、被复盘。
        </p>
        <div class="cta">
          <button class="primary big" @click="playLatest">
            {{ cleared >= totalLevels ? '再战水厂' : cleared > 0 ? '继续合同' : '开始游戏' }}
          </button>
          <button @click="store.openLevels()">选择关卡</button>
        </div>
      </div>

      <div class="cards">
        <button class="mode-card tutorial" @click="tutorial.startTutorial()">
          <div class="icon">🎓</div>
          <h2>
            新手教程
            <span v-if="tutorialIsNew" class="badge-new">新</span>
          </h2>
          <p>5 步带你走完围池、注水、排水与分流。随时可以跳过。</p>
          <div class="stat">
            <span>{{ tutorialIsNew ? '5 步 · 约 3 分钟' : '已完成' }}</span>
            <span>{{ tutorialIsNew ? '推荐先看' : '可重看' }}</span>
          </div>
        </button>

        <button class="mode-card" @click="store.openLevels()">
          <div class="icon">📜</div>
          <h2>合同模式</h2>
          <p>30 份可玩合同，数据层支持 60 关。每 5 关一个新机制。</p>
          <div class="stat">
            <span>{{ cleared }}/{{ totalLevels }} 通关</span>
            <span>★ {{ stars }}/{{ totalLevels * 3 }}</span>
          </div>
        </button>

        <button class="mode-card daily" @click="store.openDaily()">
          <div class="icon">📅</div>
          <h2>每日挑战</h2>
          <p>日期种子 + 固定块序，本地排行榜。{{ todayKey() }}</p>
          <div class="stat">
            <span>{{ todayBest ? `今日最佳 ${todayBest.score}` : '今日未挑战' }}</span>
            <span>{{ todayBest ? `${todayBest.blocks} 块` : '—' }}</span>
          </div>
        </button>

        <button class="mode-card endless" @click="store.startEndless()">
          <div class="icon">∞</div>
          <h2>无尽模式</h2>
          <p>水位持续上涨，随时会漫顶。追一个更高的分数。</p>
          <div class="stat">
            <span>最高分 {{ progress.data.endlessBest }}</span>
            <span>本地</span>
          </div>
        </button>

        <button class="mode-card editor" @click="store.openEditor()">
          <div class="icon">🧱</div>
          <h2>关卡编辑器</h2>
          <p>预览版：结构化关卡数据、JSON 导入导出。长期更新。</p>
          <div class="stat">
            <span>P2 预留</span>
            <span>只读预览</span>
          </div>
        </button>
      </div>

      <BlockGuide />

      <div class="bottom-row">
        <div class="replay-box">
          <label>回放分享码</label>
          <div class="input-row">
            <input v-model="code" placeholder="WW3-XXXXXXXX…" spellcheck="false" @keydown.enter="loadCode" />
            <button @click="loadCode">回放</button>
          </div>
        </div>
        <div class="features">
          <span>✦ 确定性水模拟</span>
          <span>✦ 三步水流预览</span>
          <span>✦ 短码分享</span>
          <span>✦ 无网络请求</span>
        </div>
      </div>

      <footer class="foot">
        <span>Waterworks 3D · v0.9 · 纯单机</span>
        <span>同种子同操作 = 完全一致的结果</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  z-index: 30;
  color: #e9f2f8;
  background: #070b10;
}
.bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.5;
}
.glow.a {
  width: 620px;
  height: 620px;
  background: radial-gradient(circle, rgba(42, 157, 196, 0.5), transparent 70%);
  top: -220px;
  left: -140px;
}
.glow.b {
  width: 520px;
  height: 520px;
  background: radial-gradient(circle, rgba(255, 183, 94, 0.28), transparent 70%);
  bottom: -200px;
  right: -100px;
}
.grid-lines {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(120, 190, 230, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120, 190, 230, 0.045) 1px, transparent 1px);
  background-size: 46px 46px;
  mask-image: radial-gradient(ellipse at 50% 35%, black 30%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse at 50% 35%, black 30%, transparent 78%);
}
.content {
  position: relative;
  max-width: 1080px;
  margin: 0 auto;
  padding: clamp(1.4rem, 5vh, 3.4rem) clamp(1rem, 4vw, 2.6rem) 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.8rem;
  min-height: 100%;
}
.title-block {
  max-width: 640px;
}
.tag {
  display: inline-block;
  font-size: 0.64rem;
  letter-spacing: 0.2em;
  color: #7fe9ff;
  border: 1px solid rgba(127, 233, 255, 0.3);
  background: rgba(127, 233, 255, 0.07);
  border-radius: 999px;
  padding: 0.22rem 0.6rem;
  text-transform: uppercase;
}
h1 {
  margin: 0.75rem 0 0.15rem;
  font-size: clamp(2.3rem, 6vw, 4rem);
  line-height: 0.98;
  letter-spacing: -0.02em;
  font-weight: 750;
  background: linear-gradient(120deg, #eafaff 10%, #7fe9ff 55%, #ffc274 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
h1 .three {
  font-size: 0.55em;
  color: #ffb75e;
  -webkit-text-fill-color: #ffb75e;
  vertical-align: super;
  letter-spacing: 0.02em;
}
.tagline {
  margin: 0.2rem 0 0.7rem;
  font-size: clamp(1rem, 2vw, 1.25rem);
  color: #ffd28a;
  letter-spacing: 0.08em;
}
.blurb {
  margin: 0 0 1.1rem;
  max-width: 560px;
  color: #9fb8c9;
  font-size: 0.86rem;
  line-height: 1.75;
}
.cta {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.cta button {
  padding: 0.7rem 1.3rem;
  border-radius: 11px;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: rgba(255, 255, 255, 0.05);
  color: #d7e7f2;
  font-size: 0.88rem;
  cursor: pointer;
  transition: 0.16s ease;
}
.cta button:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(127, 233, 255, 0.45);
}
.cta button.primary {
  background: linear-gradient(135deg, #2a9dc4, #1a6f96);
  border-color: transparent;
  color: #eafaff;
  font-weight: 650;
  box-shadow: 0 10px 30px rgba(42, 157, 196, 0.35);
}
.cta button.big {
  padding: 0.8rem 1.6rem;
  font-size: 0.94rem;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.8rem;
}
.mode-card {
  text-align: left;
  padding: 1rem;
  border-radius: 15px;
  border: 1px solid rgba(120, 190, 230, 0.16);
  background: linear-gradient(160deg, rgba(21, 36, 49, 0.92), rgba(10, 17, 24, 0.92));
  color: inherit;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
  font: inherit;
}
.mode-card:hover {
  transform: translateY(-3px);
  border-color: rgba(127, 233, 255, 0.42);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.42);
}
.mode-card.daily {
  background: linear-gradient(160deg, rgba(45, 36, 24, 0.92), rgba(15, 12, 9, 0.92));
}
.mode-card.daily:hover {
  border-color: rgba(255, 183, 94, 0.45);
}
.mode-card.endless {
  background: linear-gradient(160deg, rgba(26, 40, 34, 0.92), rgba(9, 16, 14, 0.92));
}
.mode-card.editor {
  background: linear-gradient(160deg, rgba(31, 31, 42, 0.92), rgba(11, 11, 16, 0.92));
}
.mode-card.tutorial {
  background: linear-gradient(160deg, rgba(24, 38, 46, 0.92), rgba(10, 18, 22, 0.92));
}
.mode-card.tutorial:hover {
  border-color: rgba(126, 226, 168, 0.45);
}
.badge-new {
  display: inline-block;
  margin-left: 0.35rem;
  padding: 0.05rem 0.34rem;
  border-radius: 999px;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  vertical-align: middle;
  color: #08221a;
  background: linear-gradient(135deg, #7ee2a8, #4ecf8a);
  box-shadow: 0 0 12px rgba(126, 226, 168, 0.45);
}
.icon {
  font-size: 1.4rem;
  margin-bottom: 0.3rem;
  filter: drop-shadow(0 0 10px rgba(127, 233, 255, 0.35));
}
.mode-card h2 {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}
.mode-card p {
  margin: 0 0 0.6rem;
  font-size: 0.72rem;
  line-height: 1.55;
  color: #8fa9bd;
}
.stat {
  display: flex;
  justify-content: space-between;
  font-size: 0.64rem;
  color: #6d8394;
  border-top: 1px dashed rgba(120, 190, 230, 0.14);
  padding-top: 0.45rem;
}
.bottom-row {
  display: flex;
  justify-content: space-between;
  gap: 1.2rem;
  flex-wrap: wrap;
  align-items: flex-end;
}
.replay-box {
  flex: 1;
  min-width: 260px;
  max-width: 420px;
}
.replay-box label {
  display: block;
  font-size: 0.66rem;
  color: #7fa6bf;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 0.3rem;
}
.input-row {
  display: flex;
  gap: 0.4rem;
}
.input-row input {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(120, 190, 230, 0.2);
  border-radius: 9px;
  padding: 0.5rem 0.65rem;
  color: #cdefff;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.74rem;
}
.input-row input:focus {
  outline: none;
  border-color: rgba(127, 233, 255, 0.5);
}
.input-row button {
  padding: 0.5rem 0.85rem;
  border-radius: 9px;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: rgba(255, 255, 255, 0.05);
  color: #d7e7f2;
  font-size: 0.76rem;
  cursor: pointer;
}
.features {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.9rem;
  font-size: 0.68rem;
  color: #6d8394;
  max-width: 420px;
}
.foot {
  margin-top: auto;
  padding-top: 1.2rem;
  border-top: 1px solid rgba(120, 190, 230, 0.1);
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.64rem;
  color: #55697a;
}
@media (max-width: 640px) {
  .cards {
    grid-template-columns: 1fr 1fr;
  }
  .mode-card p {
    display: none;
  }
}
</style>

