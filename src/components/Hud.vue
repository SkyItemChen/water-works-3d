<script setup lang="ts">
/**
 * HUD: objectives, ledger, next-2 preview, hold slot, pressure meter,
 * danger columns, block counter and pause / mute / preview toggles.
 */
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { BLOCKS } from '@/game/core/bag';
import { arrowQuarterTurns } from '@/game/core/blockGuide';
import NextPreview from './NextPreview.vue';
import type { BlockKind } from '@/game/core/types';

const store = useGameStore();
const settings = useSettingsStore();
const snap = computed(() => store.snapshot);

const score = computed(() => snap.value?.score ?? 0);
const blocksUsed = computed(() => snap.value?.blocksUsed ?? 0);
const blockLimit = computed(() => snap.value?.blockLimit ?? 0);
const ledger = computed(
  () =>
    snap.value?.ledger ?? {
      injected: 0,
      drainedClean: 0,
      drainedDirty: 0,
      inField: 0,
      overflowed: 0,
      pollution: 0,
      wasted: 0,
      absorbed: 0,
    },
);
const pollution = computed(() => Math.min(3, snap.value?.pollutionStrikes ?? 0));
const pressurePct = computed(() => {
  const snapV = snap.value;
  if (!snapV) return 0;
  let max = 0;
  for (let i = 0; i < snapV.pressure.length; i++) {
    max = Math.max(max, snapV.pressure[i]);
  }
  return Math.min(100, Math.round((max / 1.2) * 100));
});
const waterlinePct = computed(() => {
  const s = snap.value;
  if (!s) return 0;
  return Math.round((1 - s.waterline / s.rows) * 100);
});
const dangerColumns = computed(() => new Set(snap.value?.dangerCols ?? []));
const holdBlock = computed<BlockKind | null>(() => snap.value?.hold ?? null);
const holdUsed = computed(() => snap.value?.holdUsed ?? false);
const holdInfo = computed(() => (holdBlock.value ? BLOCKS[holdBlock.value] : null));
/** A held conduit always sits at rotation 0, so its arrow is its default `dir`. */
const holdArrow = computed(() => {
  const b = holdBlock.value;
  if (!b) return undefined;
  if (b !== 'pipe' && b !== 'valve') return undefined;
  return arrowQuarterTurns(BLOCKS[b].dir ?? 2);
});

const goalList = computed(() => snap.value?.goals ?? []);

const ledgerBalanced = computed(() => {
  const l = ledger.value;
  const sum = l.drainedClean + l.drainedDirty + l.inField + l.overflowed;
  return Math.abs(sum - l.injected) < 0.6;
});

function fmt(v: number, digits = 1): string {
  return v.toFixed(digits);
}
</script>

<template>
  <div class="hud" v-if="snap">
    <header class="hud-top">
      <div class="hud-title">
        <span class="chip">{{ snap.levelId.startsWith('daily') ? '每日' : snap.levelId === 'endless' ? '无尽' : '合同' }}</span>
        <div>
          <h1>{{ snap.levelName }}</h1>
          <p class="sub">
            <span>种子 {{ snap.seed }}</span>
            <span class="dot">·</span>
            <span>第 {{ blocksUsed }}/{{ blockLimit }} 块</span>
          </p>
        </div>
      </div>

      <div class="hud-actions">
        <button class="icon-btn" :title="settings.muted ? '取消静音 (M)' : '静音 (M)'" @click="settings.toggleMute()">
          {{ settings.muted ? '🔇' : '🔊' }}
        </button>
        <button
          class="icon-btn"
          :class="{ on: store.previewEnabled && settings.showPreview }"
          title="水流预览 (V)"
          @click="store.togglePreview()"
        >
          👁
        </button>
        <button class="icon-btn" title="暂停 (Esc)" @click="store.togglePause()">⏸</button>
      </div>
    </header>

    <section class="panel goals">
      <h2>合同目标</h2>
      <ul>
        <li v-for="(g, i) in goalList" :key="i" :class="{ done: g.done }">
          <span class="tick">{{ g.done ? '✔' : '○' }}</span>
          <span class="goal-label">{{ g.label }}</span>
          <span class="goal-num">
            {{ Math.min(g.current, g.target).toFixed(1) }} / {{ g.target }}
          </span>
        </li>
      </ul>
      <div class="score-row">
        <span>得分</span>
        <strong>{{ score }}</strong>
      </div>
    </section>

    <section class="panel ledger">
      <h2>水账本</h2>
      <div class="ledger-grid">
        <div><span>总下落</span><b>{{ fmt(ledger.injected) }}</b></div>
        <div><span>已排清水</span><b class="clean">{{ fmt(ledger.drainedClean) }}</b></div>
        <div><span>已排污水</span><b class="dirty">{{ fmt(ledger.drainedDirty) }}</b></div>
        <div><span>在场</span><b>{{ fmt(ledger.inField) }}</b></div>
        <div><span>溢出</span><b :class="{ warn: ledger.overflowed > 0.01 }">{{ fmt(ledger.overflowed) }}</b></div>
        <div><span>海绵吸存</span><b>{{ fmt(ledger.absorbed) }}</b></div>
      </div>
      <p class="balance" :class="{ ok: ledgerBalanced }">
        {{ ledgerBalanced ? '✔ 水量守恒' : '⋯ 水体结算中' }}
      </p>
    </section>

    <section class="panel vitals">
      <h2>压力 / 水位</h2>
      <div class="meter">
        <span>系统压力</span>
        <div class="bar"><i :style="{ width: pressurePct + '%' }" :class="{ hot: pressurePct > 70 }"></i></div>
        <b>{{ pressurePct }}%</b>
      </div>
      <div class="meter">
        <span>安全余量</span>
        <div class="bar water"><i :style="{ width: waterlinePct + '%' }"></i></div>
        <b>{{ waterlinePct }}%</b>
      </div>
      <div class="strikes">
        <span>清水口污染</span>
        <span class="pips">
          <i v-for="n in 3" :key="n" :class="{ filled: pollution >= n }"></i>
        </span>
        <b>{{ pollution }}/3</b>
      </div>
      <div class="danger-cols" v-if="dangerColumns.size">
        <span>危险列</span>
        <span class="cols">
          <b v-for="c in [...dangerColumns].sort((a, b) => a - b)" :key="c">第 {{ c + 1 }} 列</b>
        </span>
      </div>
    </section>

    <section class="panel next-panel">
      <h2>Next</h2>
      <div class="next-row">
        <NextPreview :kinds="snap.next.slice(0, 3)" :cols="snap.cols" :rows="snap.rows" />
      </div>
      <div class="hold-row">
        <span class="label">保留 (Shift)</span>
        <div class="hold-slot" :class="{ used: holdUsed }">
          <div v-if="holdInfo" class="mini-block" :style="{ '--c': holdInfo.color }">
            <i v-for="(c, k) in holdInfo.cells" :key="k" :style="{ gridColumn: c.x + 1, gridRow: c.y + 1 }"></i>
            <span
              v-if="holdArrow !== undefined"
              class="mini-arrow"
              :style="{ '--rot': holdArrow * 90 + 'deg' }"
              aria-hidden="true"
            ><i></i></span>
          </div>
          <span v-else class="empty">空</span>
        </div>
      </div>
    </section>

    <footer class="hud-keys">
      <span>← → 移动</span>
      <span>↑ / X 旋转<span class="hud-hint">（管道箭头随之转向）</span></span>
      <span>空格 硬降</span>
      <span>Shift 保留</span>
      <span>R 重开</span>
      <span>Esc 暂停</span>
    </footer>
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  display: grid;
  grid-template-columns: minmax(190px, 220px) 1fr minmax(190px, 220px);
  grid-template-rows: auto 1fr auto;
  gap: 0.7rem;
  padding: 0.8rem;
  color: var(--text, #e9f2f8);
  font-size: 0.8rem;
}
.hud-top {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  pointer-events: none;
}
.hud-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  pointer-events: auto;
  background: linear-gradient(120deg, rgba(13, 22, 31, 0.88), rgba(13, 22, 31, 0.55));
  border: 1px solid rgba(120, 190, 230, 0.18);
  border-radius: 12px;
  padding: 0.5rem 0.8rem;
  backdrop-filter: blur(6px);
}
.chip {
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  padding: 0.18rem 0.4rem;
  border-radius: 999px;
  background: rgba(255, 183, 94, 0.16);
  color: #ffc274;
  border: 1px solid rgba(255, 183, 94, 0.35);
}
h1 {
  font-size: 0.95rem;
  margin: 0;
  font-weight: 650;
  letter-spacing: 0.02em;
}
.sub {
  margin: 0.1rem 0 0;
  color: #8fa9bd;
  font-size: 0.68rem;
}
.dot {
  margin: 0 0.3rem;
}
.hud-actions {
  display: flex;
  gap: 0.35rem;
  pointer-events: auto;
}
.icon-btn {
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 10px;
  border: 1px solid rgba(120, 190, 230, 0.22);
  background: rgba(13, 22, 31, 0.82);
  color: #cfe4f2;
  cursor: pointer;
  font-size: 0.95rem;
  transition: 0.15s ease;
}
.icon-btn:hover {
  border-color: rgba(120, 200, 240, 0.5);
  background: rgba(28, 45, 60, 0.92);
}
.icon-btn.on {
  color: #7fe9ff;
  border-color: rgba(127, 233, 255, 0.5);
}
.panel {
  pointer-events: auto;
  background: linear-gradient(160deg, rgba(12, 21, 30, 0.86), rgba(10, 17, 24, 0.7));
  border: 1px solid rgba(120, 190, 230, 0.16);
  border-radius: 12px;
  padding: 0.6rem 0.7rem;
  backdrop-filter: blur(7px);
  align-self: start;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}
.panel h2 {
  margin: 0 0 0.4rem;
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7fa6bf;
  font-weight: 600;
}
.goals {
  grid-column: 1;
  grid-row: 2;
}
.goals ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.28rem;
}
.goals li {
  display: grid;
  grid-template-columns: 1rem 1fr auto;
  gap: 0.3rem;
  align-items: baseline;
  font-size: 0.72rem;
  color: #c6d8e5;
}
.goals li.done {
  color: #8ef0b6;
}
.goals li.done .goal-label {
  text-decoration: line-through;
  opacity: 0.75;
}
.tick {
  color: #ffb75e;
}
.goals li.done .tick {
  color: #8ef0b6;
}
.goal-num {
  font-variant-numeric: tabular-nums;
  color: #9fb8c9;
  font-size: 0.66rem;
}
.score-row {
  margin-top: 0.45rem;
  padding-top: 0.4rem;
  border-top: 1px dashed rgba(120, 190, 230, 0.2);
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.75rem;
  color: #9fb8c9;
}
.score-row strong {
  font-size: 1.05rem;
  color: #ffd28a;
  font-variant-numeric: tabular-nums;
}
.ledger {
  grid-column: 1;
  grid-row: 3;
  align-self: end;
}
.ledger-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.2rem 0.5rem;
  font-size: 0.66rem;
  color: #8fa9bd;
}
.ledger-grid div {
  display: flex;
  justify-content: space-between;
}
.ledger-grid b {
  color: #d7e7f2;
  font-variant-numeric: tabular-nums;
}
.ledger-grid b.clean {
  color: #5fd6ff;
}
.ledger-grid b.dirty {
  color: #b7c46a;
}
.ledger-grid b.warn {
  color: #ff8a8a;
}
.balance {
  margin: 0.35rem 0 0;
  font-size: 0.62rem;
  color: #8b9dab;
}
.balance.ok {
  color: #6ee7a0;
}
.vitals {
  grid-column: 3;
  grid-row: 2;
}
.meter {
  display: grid;
  grid-template-columns: 4.2rem 1fr 2.2rem;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.66rem;
  color: #9fb8c9;
  margin-bottom: 0.28rem;
}
.bar {
  height: 0.4rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #4ad2a0, #ffc857 60%, #ff6b6b);
  transition: width 0.18s ease;
}
.bar i.hot {
  animation: pulse 0.9s infinite;
}
.bar.water i {
  background: linear-gradient(90deg, #1b6f96, #39c5ff);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
.meter b {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #d7e7f2;
}
.strikes,
.danger-cols {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.66rem;
  color: #9fb8c9;
  margin-top: 0.35rem;
}
.pips {
  display: flex;
  gap: 0.22rem;
}
.pips i {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.pips i.filled {
  background: #ff5a7a;
  border-color: #ff8ba3;
  box-shadow: 0 0 8px rgba(255, 90, 122, 0.6);
}
.danger-cols .cols {
  display: flex;
  gap: 0.25rem;
  color: #ff9b9b;
  animation: pulse 1s infinite;
}
.next-panel {
  grid-column: 3;
  grid-row: 3;
  align-self: end;
}
.next-row {
  display: flex;
  justify-content: flex-end;
}
.hold-row {
  margin-top: 0.45rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.66rem;
  color: #8fa9bd;
}
.hold-slot {
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 8px;
  border: 1px dashed rgba(120, 190, 230, 0.3);
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.03);
}
.hold-slot.used {
  opacity: 0.35;
}
.hold-slot .empty {
  font-size: 0.6rem;
  color: #61788a;
}
.mini-block {
  position: relative;
  display: grid;
  grid-auto-rows: 0.55rem;
  gap: 1px;
}
.mini-arrow {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  /* CSS triangle, not a glyph: arrow characters are not reliably covered by
     every font and turn into tofu boxes. */
  transform: rotate(var(--rot));
  pointer-events: none;
  z-index: 1;
}
.mini-arrow i {
  width: 80%;
  height: 80%;
  background: #0b1720;
  clip-path: polygon(50% 0%, 100% 55%, 66% 55%, 66% 100%, 34% 100%, 34% 55%, 0% 55%);
}
.mini-block i {
  width: 0.55rem;
  height: 0.55rem;
  background: var(--c);
  border-radius: 1px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}
.hud-hint {
  margin-left: 0.15rem;
  color: #5f7c90;
}
.hud-keys {
  grid-column: 2;
  grid-row: 3;
  justify-self: center;
  align-self: end;
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  justify-content: center;
  font-size: 0.62rem;
  color: #7d94a5;
  background: rgba(10, 17, 24, 0.7);
  border: 1px solid rgba(120, 190, 230, 0.12);
  border-radius: 999px;
  padding: 0.32rem 0.8rem;
  pointer-events: none;
}
@media (max-width: 900px) {
  .hud {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto 1fr auto;
    font-size: 0.75rem;
  }
  .panel.goals,
  .panel.vitals,
  .panel.ledger,
  .panel.next-panel {
    grid-column: 1;
    grid-row: auto;
  }
  .panel.vitals,
  .panel.ledger {
    display: none;
  }
  .hud-keys {
    display: none;
  }
  .next-panel {
    justify-self: end;
    min-width: 0;
  }
}
</style>
