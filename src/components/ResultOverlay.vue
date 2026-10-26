<script setup lang="ts">
/**
 * ResultOverlay — win / loss summary with explicit failure reason,
 * star breakdown, ledger, and share-code generation.
 */
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useProgressStore } from '@/stores/progressStore';
import { copyToClipboard } from '@/game/core/shareCode';
import { todayKey } from '@/game/core/daily';
import { isTutorialLevelId } from '@/game/core/level';
import { useTutorialStore } from '@/stores/tutorialStore';

const store = useGameStore();
const progress = useProgressStore();
const tutorial = useTutorialStore();

/** Tutorial runs are coached by TutorialOverlay: no win card, no share code. */
const inTutorial = computed(() => !!store.level && isTutorialLevelId(store.level.id));
const inEditor = computed(() => store.mode === 'editor');
/**
 * A coached step's *win* belongs to the coach (the bubble shows the ✔ and the
 * tutorial advances by itself), but a *failure* — block budget spent, drain
 * blocked — has to be explained. Hiding it left the board frozen with the coach
 * still coaching a dead run and no way forward.
 */
const cardVisible = computed(() => {
  if (!store.showResult || !store.result) return false;
  if (inTutorial.value && store.result.won) return false;
  return true;
});

const result = computed(() => store.result);
const won = computed(() => !!result.value?.won);
const stars = computed(() => result.value?.stars ?? 0);
/** Challenge verdict: the score bar, not the contract goals, decides. */
const isChallenge = computed(() => !!store.challengeId);
const challengeTarget = computed(() => store.challengeTarget);
const challengeCleared = computed(() => store.challengeOutcome === 'cleared');
const challengeShort = computed(
  () => isChallenge.value && !!result.value?.won && !challengeCleared.value,
);
const reason = computed(() => {
  const r = result.value;
  if (!r) return '';
  if (isChallenge.value) {
    if (!r.won) return r.reason || '挑战失败：合同本身没有完成。';
    if (challengeCleared.value) return '达标。这就是这个关卡的已知最高分。';
    return `还差 ${Math.max(0, challengeTarget.value - r.score)} 分：目标 ${challengeTarget.value}，本局 ${r.score}。`;
  }
  if (r.won) return '合同达成，最后一批水已经排空。';
  return r.reason || '合同失败';
});
const ledger = computed(() => result.value?.ledger);
const goals = computed(() => result.value?.goals ?? []);
const nextIndex = computed(() => {
  const lvl = store.level;
  if (!lvl || store.mode !== 'contract') return null;
  return lvl.index + 1 <= store.levels.length ? lvl.index + 1 : null;
});
const bestScore = computed(() => {
  const id = store.level?.id;
  if (!id) return 0;
  if (store.mode === 'daily') return progress.dailyBest(todayKey())?.score ?? 0;
  if (store.mode === 'endless') return progress.data.endlessBest;
  return progress.levelRecords[id]?.bestScore ?? 0;
});

async function share(): Promise<void> {
  if (!store.shareCode) return;
  const ok = await copyToClipboard(store.shareCode);
  store.shareFeedback = ok ? '短码已复制到剪贴板' : '复制失败，请手动选择文本';
  setTimeout(() => (store.shareFeedback = ''), 2200);
}

function selectCode(e: FocusEvent): void {
  (e.target as HTMLTextAreaElement).select();
}

function nextLevel(): void {
  const idx = nextIndex.value;
  if (idx == null) return;
  store.startIndex(idx);
}

function retry(): void {
  store.restart();
}

function concede(): void {
  store.concedeChallenge();
}

async function shareOfficial(): Promise<void> {
  if (!store.challengeCode) return;
  const ok = await copyToClipboard(store.challengeCode);
  store.shareFeedback = ok ? '官方回放码已复制' : '复制失败，请手动选择文本';
  setTimeout(() => (store.shareFeedback = ''), 2200);
}

function watchOfficial(): void {
  if (store.challengeCode) store.loadReplayCode(store.challengeCode);
}

function quit(): void {
  store.closeResult();
  // Leaving a failed tutorial step means leaving the tutorial: the coach would
  // otherwise keep its bubble (and its step pointer) over the main menu.
  if (inTutorial.value) tutorial.quitTutorial();
  else store.leaveRun();
}
</script>

<template>
  <Transition name="pop">
    <div v-if="cardVisible && result" class="overlay" :class="{ won, lost: !won }">
      <div class="card">
        <div class="badge">
          {{
            inEditor
              ? won
                ? '试玩完成'
                : '试玩结束'
              : isChallenge
                ? challengeCleared
                  ? '挑战通过'
                  : won
                    ? '未达目标'
                    : '挑战失败'
                : won
                  ? '合同完成'
                  : '合同失败'
          }}
        </div>
        <h2>
          {{ isChallenge ? (challengeCleared ? '最优解达成' : won ? '差一点' : '水厂停摆') : won ? '水流全部归位' : '水厂停摆' }}
        </h2>
        <p class="reason" :class="{ bad: !won }">{{ reason }}</p>

        <div v-if="won" class="stars" aria-label="星级">
          <span v-for="n in 3" :key="n" class="star" :class="{ filled: stars >= n }">★</span>
        </div>

        <div class="stats">
          <div>
            <span>得分</span>
            <b>{{ result.score }}</b>
          </div>
          <div>
            <span>用块</span>
            <b>{{ result.blocksUsed }}</b>
          </div>
          <div>
            <span>用时</span>
            <b>{{ (result.durationTicks / 60).toFixed(0) }}s</b>
          </div>
          <div>
            <span>历史最佳</span>
            <b>{{ bestScore }}</b>
          </div>
          <div v-if="isChallenge">
            <span>挑战目标</span>
            <b class="target">{{ challengeTarget }}</b>
          </div>
        </div>

        <div v-if="isChallenge" class="challenge-box" :class="{ passed: challengeCleared }">
          <template v-if="challengeCleared">
            <b>✔ 挑战达成</b>
            <p>目标 {{ challengeTarget }}，本局 {{ result.score }}。</p>
          </template>
          <template v-else>
            <b>{{ challengeShort ? '目标分未达成' : '这一局没走完' }}</b>
            <p v-if="challengeShort">
              只完成合同不算通过：得打到 {{ challengeTarget }} 分。认输会记一次，并直接给你这一关的官方回放码。
            </p>
            <p v-else>
              合同本身先失败了（{{ result.reason || '未能完成合同' }}）。目标分是 {{ challengeTarget }}，
              也可以直接认输，看官方是怎么走完的。
            </p>
            <button v-if="!store.challengeConceded" class="concede" @click="concede">
              认输 · 查看官方回放码
            </button>
            <template v-else>
              <textarea
                :value="store.challengeCode"
                readonly
                rows="2"
                @focus="selectCode"
                @click="selectCode"
              ></textarea>
              <div class="share-actions">
                <button class="primary sm" @click="shareOfficial">复制回放码</button>
                <button class="ghost sm" @click="watchOfficial">看官方回放</button>
                <span class="feedback">{{ store.shareFeedback }}</span>
              </div>
            </template>
          </template>
        </div>

        <ul class="goals">
          <li v-for="(g, i) in goals" :key="i" :class="{ done: g.done }">
            <span>{{ g.done ? '✔' : '✕' }}</span>
            {{ g.label }}
          </li>
        </ul>

        <div v-if="ledger" class="ledger">
          <div><span>清水排出</span><b class="clean">{{ ledger.drainedClean.toFixed(1) }}</b></div>
          <div><span>污水排出</span><b class="dirty">{{ ledger.drainedDirty.toFixed(1) }}</b></div>
          <div><span>在场</span><b>{{ ledger.inField.toFixed(1) }}</b></div>
          <div><span>溢出</span><b>{{ ledger.overflowed.toFixed(2) }}</b></div>
        </div>

        <div v-if="won && store.shareCode" class="share">
          <h3>分享你的解法</h3>
          <p>把短码发给朋友，对方输入同一短码即可回放这次通关。</p>
          <textarea :value="store.shareCode" readonly rows="2" @focus="selectCode" @click="selectCode"></textarea>
          <div class="share-actions">
            <button class="primary sm" @click="share">复制短码</button>
            <span class="feedback">{{ store.shareFeedback }}</span>
          </div>
        </div>

        <div class="actions">
          <template v-if="isChallenge">
            <button v-if="!challengeCleared" class="primary" @click="retry">再挑战一次</button>
            <button @click="quit">返回挑战列表</button>
          </template>
          <template v-else-if="won">
            <button v-if="nextIndex != null" class="primary" @click="nextLevel">下一关 →</button>
            <button @click="retry">再打一次</button>
            <button class="ghost" @click="quit">{{ inEditor ? '返回编辑器' : '返回主菜单' }}</button>
          </template>
          <template v-else>
            <button class="primary" @click="retry">重试本关</button>
            <button class="ghost" @click="quit">{{ inEditor ? '返回编辑器' : '返回主菜单' }}</button>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: rgba(4, 8, 12, 0.78);
  backdrop-filter: blur(7px);
  overflow-y: auto;
  padding: 1rem;
}
.card {
  width: min(520px, 94vw);
  background: linear-gradient(165deg, #12202c, #0a121a 70%);
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 20px;
  padding: 1.5rem;
  color: #e9f2f8;
  box-shadow: 0 34px 90px rgba(0, 0, 0, 0.65);
  position: relative;
  max-height: 94vh;
  overflow-y: auto;
}
.overlay.won .card {
  border-color: rgba(110, 231, 160, 0.34);
  box-shadow: 0 30px 90px rgba(30, 120, 90, 0.28), 0 0 0 1px rgba(110, 231, 160, 0.08) inset;
}
.overlay.lost .card {
  border-color: rgba(255, 110, 120, 0.3);
}
.challenge-box {
  margin: 0.9rem 0 0.2rem;
  padding: 0.8rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 183, 94, 0.32);
  background: rgba(255, 183, 94, 0.07);
}
.challenge-box.passed {
  border-color: rgba(110, 231, 160, 0.4);
  background: rgba(110, 231, 160, 0.08);
}
.challenge-box b {
  font-size: 0.8rem;
  color: #ffd7a1;
}
.challenge-box.passed b {
  color: #8ef0b6;
}
.challenge-box p {
  margin: 0.3rem 0 0.6rem;
  font-size: 0.72rem;
  line-height: 1.55;
  color: #a8bccb;
}
.challenge-box textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(120, 190, 230, 0.24);
  border-radius: 9px;
  color: #cdefff;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.7rem;
  padding: 0.5rem;
  resize: none;
}
.concede {
  padding: 0.45rem 0.85rem;
  border-radius: 9px;
  border: 1px solid rgba(255, 183, 94, 0.45);
  background: rgba(255, 183, 94, 0.14);
  color: #ffd7a1;
  font-size: 0.76rem;
  cursor: pointer;
}
.concede:hover {
  background: rgba(255, 183, 94, 0.24);
}
.stats .target {
  color: #7fe9ff;
}
.badge {
  display: inline-block;
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  background: rgba(255, 183, 94, 0.14);
  color: #ffc274;
  border: 1px solid rgba(255, 183, 94, 0.34);
}
.overlay.won .badge {
  background: rgba(110, 231, 160, 0.14);
  color: #8ef0b6;
  border-color: rgba(110, 231, 160, 0.4);
}
.overlay.lost .badge {
  background: rgba(255, 110, 120, 0.14);
  color: #ff9ba3;
  border-color: rgba(255, 110, 120, 0.4);
}
h2 {
  margin: 0.5rem 0 0.3rem;
  font-size: 1.5rem;
  letter-spacing: 0.01em;
}
.reason {
  margin: 0 0 0.9rem;
  color: #9fb8c9;
  font-size: 0.85rem;
  line-height: 1.55;
}
.reason.bad {
  color: #ffb0b0;
  background: rgba(255, 90, 90, 0.07);
  border: 1px solid rgba(255, 90, 90, 0.22);
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
}
.stars {
  display: flex;
  gap: 0.3rem;
  margin: 0.2rem 0 0.9rem;
}
.star {
  font-size: 1.7rem;
  color: rgba(255, 255, 255, 0.12);
  transition: 0.25s ease;
}
.star.filled {
  color: #ffd166;
  text-shadow: 0 0 16px rgba(255, 209, 102, 0.6);
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
  margin-bottom: 0.8rem;
}
.stats div {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(120, 190, 230, 0.1);
  border-radius: 10px;
  padding: 0.45rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.stats span {
  font-size: 0.6rem;
  color: #7d94a5;
}
.stats b {
  font-size: 1rem;
  color: #ffd28a;
  font-variant-numeric: tabular-nums;
}
.goals {
  list-style: none;
  margin: 0 0 0.7rem;
  padding: 0;
  display: grid;
  gap: 0.25rem;
  font-size: 0.76rem;
  color: #b9cbd8;
}
.goals li {
  display: flex;
  gap: 0.4rem;
}
.goals li.done {
  color: #8ef0b6;
}
.ledger {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.2rem 0.8rem;
  font-size: 0.68rem;
  color: #8fa9bd;
  border-top: 1px dashed rgba(120, 190, 230, 0.18);
  padding-top: 0.6rem;
  margin-bottom: 0.9rem;
}
.ledger div {
  display: flex;
  justify-content: space-between;
}
.ledger b {
  color: #d7e7f2;
  font-variant-numeric: tabular-nums;
}
.ledger b.clean {
  color: #5fd6ff;
}
.ledger b.dirty {
  color: #b7c46a;
}
.share {
  background: rgba(127, 233, 255, 0.05);
  border: 1px solid rgba(127, 233, 255, 0.18);
  border-radius: 12px;
  padding: 0.75rem;
  margin-bottom: 0.9rem;
}
.share h3 {
  margin: 0 0 0.2rem;
  font-size: 0.82rem;
  color: #9be8ff;
}
.share p {
  margin: 0 0 0.5rem;
  font-size: 0.68rem;
  color: #8fa9bd;
  line-height: 1.5;
}
textarea {
  width: 100%;
  resize: none;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 8px;
  color: #cdefff;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.7rem;
  padding: 0.45rem 0.5rem;
  word-break: break-all;
}
.share-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.45rem;
}
.feedback {
  font-size: 0.66rem;
  color: #8ef0b6;
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
button {
  flex: 1;
  min-width: 96px;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: rgba(255, 255, 255, 0.05);
  color: #d7e7f2;
  font-size: 0.82rem;
  cursor: pointer;
  transition: 0.15s ease;
}
button:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(127, 233, 255, 0.45);
}
button.primary {
  background: linear-gradient(135deg, #2a9dc4, #1a6f96);
  border-color: transparent;
  color: #eafaff;
  font-weight: 600;
}
button.ghost {
  background: transparent;
}
button.sm {
  flex: 0 0 auto;
  padding: 0.4rem 0.75rem;
  font-size: 0.74rem;
}
.pop-enter-active {
  transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.pop-enter-from {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
</style>
