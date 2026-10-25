<script setup lang="ts">
/**
 * TutorialOverlay — the coach bubble painted above GameCanvas.
 *
 * Two modes, both presentation-only:
 *  - briefing: the step has just opened; the run is held by the tutorial store
 *    (`game.coachHold`), so the bubble is a centred prompt and closing it is
 *    what starts the water. No 下一步 button: clearing the step advances by
 *    itself (the store owns that timer), and 跳过教程 lives on the tutorial's
 *    own landing page, not here.
 *  - playing: the bubble is folded into the top-centre chip; clicking it re-opens
 *    a *read-only* copy (a read never freezes a run in progress).
 *
 * Highlighting is expressed with props/classes only — GameCanvas' rendering
 * logic is never touched, and no Three.js object is created here.
 */
import { computed } from 'vue';
import { useTutorialStore } from '@/stores/tutorialStore';
import { useGameStore } from '@/stores/gameStore';
import { isTutorialLevelId } from '@/game/core/level';

const tutorial = useTutorialStore();
const store = useGameStore();

const step = computed(() => tutorial.step);
/**
 * Only visible while the active level really is a tutorial level. That keeps the
 * coach off contract/daily screens even if the player left the tutorial through
 * the pause menu (which cannot reset the store on its own).
 */
const visible = computed(
  () =>
    tutorial.running &&
    !tutorial.intro &&
    !!tutorial.step &&
    !!store.level &&
    isTutorialLevelId(store.level.id),
);
/**
 * The bubble is open unless the player folded it away. A completed step always
 * re-opens it (the store enforces that), so this is only "hidden while working".
 */
const bubbleOpen = computed(() => visible.value && !tutorial.dismissed);
/** The run is waiting on this bubble: read it, close it, then play. */
const briefing = computed(() => bubbleOpen.value && tutorial.holdRun);

/** Step counter shared by the bubble and the collapsed chip. */
const counter = computed(() => tutorial.label);

const progressPct = computed(() => {
  const total = tutorial.total || 1;
  return Math.round(((tutorial.state.stepIndex + 1) / total) * 100);
});

/** Closing the briefing starts the step; closing a read-only bubble just folds it. */
function onClose(): void {
  tutorial.dismiss();
}

/** Re-open from the collapsed chip (never re-arms the hold). */
function onReopen(): void {
  tutorial.reopen();
}
</script>

<template>
  <Transition name="tut">
    <div v-if="visible" class="tutorial" role="region" aria-label="新手教程">
      <!-- Dim the well while the run is held, so the prompt reads as a gate. -->
      <div v-if="briefing" class="briefing-shade" aria-hidden="true"></div>

      <!-- Column highlight band, drawn behind the bubble. Hidden together with
           the bubble: closing the coach should give a clean view of the well. -->
      <div v-if="bubbleOpen" class="column-marks" aria-hidden="true">
        <i
          v-for="c in step?.highlight.columns ?? []"
          :key="`col-${c}`"
          class="col-mark"
          :style="{ '--col': c }"
        ></i>
      </div>

      <!-- Collapsed chip: the only thing on screen after closing. Click to re-read. -->
      <button
        v-if="!bubbleOpen"
        class="coach-chip"
        :class="{ cleared: tutorial.satisfied }"
        type="button"
        :aria-label="`重新查看新手教程（${counter}）`"
        @click="onReopen"
      >
        <span class="chip-dot" aria-hidden="true">{{ tutorial.satisfied ? '✔' : '?' }}</span>
        <span class="chip-label">教程 {{ counter }}</span>
      </button>

      <div v-if="bubbleOpen" class="bubble" :class="{ cleared: tutorial.satisfied, briefing }">
        <header>
          <span class="kicker">新手教程</span>
          <span class="counter">{{ tutorial.label }}</span>
          <button
            v-if="!tutorial.satisfied"
            class="close"
            type="button"
            :title="briefing ? '关闭提示并开始本步' : '收起教程'"
            :aria-label="briefing ? '关闭提示并开始本步' : '收起新手教程'"
            @click="onClose"
          >×</button>
        </header>

        <h3>{{ step?.title }}</h3>
        <p class="goal">
          <span class="tick">{{ tutorial.satisfied ? '✔' : '○' }}</span>
          {{ step?.goalText }}
        </p>
        <p v-if="step?.hint" class="hint">{{ step.hint }}</p>

        <div class="bar"><i :style="{ width: progressPct + '%' }"></i></div>

        <div class="actions">
          <!-- No 下一步 / 跳过 here: clearing the step advances on its own, and
               skipping is a landing-page decision. -->
          <p v-if="tutorial.satisfied" class="auto-note">
            <span class="spinner" aria-hidden="true"></span>
            {{ tutorial.isLastStep ? '教程完成，正在返回主菜单…' : '本步完成，正在进入下一步…' }}
          </p>
          <template v-else>
            <button class="primary" type="button" @click="onClose">
              {{ tutorial.briefed ? '收起提示' : '开始本步' }}
            </button>
            <span v-if="briefing" class="gate-note">关闭提示后水流才会启动</span>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tutorial {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 26;
}
/* Sits between the board and the bubble while the run is held. Never swallows
   clicks: the pause menu and HUD stay reachable. */
.briefing-shade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(58% 48% at 50% 50%, rgba(4, 10, 16, 0.28), rgba(4, 10, 16, 0.66));
}
.column-marks {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
/* A soft vertical band per highlighted column; purely decorative, never
   interactive, and positioned in CSS so no render code is involved. */
.col-mark {
  position: absolute;
  top: 14%;
  bottom: 12%;
  width: 3.2%;
  left: calc(50% + (var(--col) - 4.5) * 3.2%);
  background: linear-gradient(180deg, rgba(127, 233, 255, 0.16), rgba(127, 233, 255, 0.04) 70%, transparent);
  border-radius: 8px;
  box-shadow: 0 0 24px rgba(127, 233, 255, 0.22);
  animation: markPulse 2.4s ease-in-out infinite;
}
@keyframes markPulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 0.9;
  }
}
/* Desktop: dead centre — the run is held, so covering the well is the point. */
.bubble {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(430px, calc(100vw - 2rem));
  pointer-events: auto;
  padding: 0.95rem 1.05rem 0.85rem;
  border-radius: 15px;
  border: 1px solid rgba(127, 233, 255, 0.28);
  background: linear-gradient(160deg, rgba(16, 30, 42, 0.96), rgba(9, 15, 21, 0.96));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  color: #e3f0f8;
}
.bubble.briefing {
  border-color: rgba(127, 233, 255, 0.42);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.62), 0 0 0 1px rgba(127, 233, 255, 0.12) inset;
}
.bubble.cleared {
  border-color: rgba(126, 226, 168, 0.5);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(126, 226, 168, 0.18) inset;
}
.bubble header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.bubble header .counter {
  margin-left: auto;
}
/* The close affordance must read as a control, not decoration. */
.bubble .close {
  flex: 0 0 auto;
  width: 1.5rem;
  height: 1.5rem;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(120, 190, 230, 0.22);
  background: rgba(255, 255, 255, 0.04);
  color: #9fbccd;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: 0.16s ease;
}
.bubble .close:hover {
  border-color: rgba(127, 233, 255, 0.5);
  color: #eafaff;
  background: rgba(127, 233, 255, 0.1);
}
.coach-chip {
  /* Top-centre: the HUD owns the corners (level card top-left, ledger
     bottom-left, next-preview bottom-right), so a corner chip collides with it. */
  position: absolute;
  top: 0.7rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.7rem 0.4rem 0.42rem;
  border-radius: 999px;
  border: 1px solid rgba(127, 233, 255, 0.3);
  background: linear-gradient(160deg, rgba(16, 30, 42, 0.94), rgba(9, 15, 21, 0.94));
  color: #cfe4f1;
  font: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(8px);
  transition: 0.16s ease;
}
.coach-chip:hover {
  border-color: rgba(127, 233, 255, 0.6);
  transform: translateX(-50%) translateY(-1px);
}
.coach-chip.cleared {
  border-color: rgba(126, 226, 168, 0.55);
}
.chip-dot {
  width: 1.15rem;
  height: 1.15rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 0.62rem;
  font-weight: 700;
  color: #08221a;
  background: linear-gradient(135deg, #7ee2a8, #4ecf8a);
}
.coach-chip:not(.cleared) .chip-dot {
  color: #06202b;
  background: linear-gradient(135deg, #7fe9ff, #2a9dc4);
}
.chip-label {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.kicker {
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #7fe9ff;
}
.counter {
  font-size: 0.66rem;
  color: #8fa9bd;
  font-variant-numeric: tabular-nums;
}
.bubble h3 {
  margin: 0 0 0.4rem;
  font-size: 1rem;
  letter-spacing: 0.01em;
}
.goal {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  line-height: 1.6;
  color: #cfe4f1;
  display: flex;
  gap: 0.4rem;
}
.goal .tick {
  color: #ffc857;
  flex: 0 0 auto;
}
.bubble.cleared .goal .tick {
  color: #7ee2a8;
}
.hint {
  margin: 0 0 0.6rem;
  font-size: 0.72rem;
  line-height: 1.65;
  color: #8fa9bd;
}
.bar {
  height: 3px;
  border-radius: 999px;
  background: rgba(120, 190, 230, 0.16);
  overflow: hidden;
  margin-bottom: 0.7rem;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2a9dc4, #7fe9ff);
  transition: width 0.28s ease;
}
.actions {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 2rem;
}
.actions button {
  padding: 0.42rem 0.95rem;
  border-radius: 9px;
  font-size: 0.76rem;
  cursor: pointer;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: rgba(255, 255, 255, 0.05);
  color: #d7e7f2;
  transition: 0.16s ease;
}
.actions button:hover:not(:disabled) {
  border-color: rgba(127, 233, 255, 0.45);
  background: rgba(255, 255, 255, 0.1);
}
.actions button.primary {
  background: linear-gradient(135deg, #2a9dc4, #1a6f96);
  border-color: transparent;
  color: #eafaff;
  font-weight: 620;
}
.gate-note {
  margin: 0;
  font-size: 0.68rem;
  color: #8fa9bd;
}
.auto-note {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.76rem;
  color: #9fdcbd;
}
.spinner {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 50%;
  border: 2px solid rgba(126, 226, 168, 0.28);
  border-top-color: #7ee2a8;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.tut-enter-active,
.tut-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.tut-enter-from,
.tut-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
/* Narrow screens keep the bubble as a bottom sheet: a centred card would cover
   the whole well plus the touch pad. */
@media (max-width: 720px) {
  .bubble {
    left: 0.6rem;
    right: 0.6rem;
    top: auto;
    bottom: 5.4rem;
    transform: none;
    width: auto;
    padding: 0.95rem 1rem 0.9rem;
  }
  .coach-chip {
    top: 0.55rem;
  }
}
</style>
