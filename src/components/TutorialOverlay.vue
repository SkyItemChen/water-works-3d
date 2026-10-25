<script setup lang="ts">
/**
 * TutorialOverlay — a non-blocking coach layer painted ABOVE GameCanvas.
 *
 * It is purely presentational: it reads the tutorial store's current step and
 * paints a hint bubble, a step counter and the escape hatches (收起 / 跳过 /
 * 下一步). Highlighting is expressed with props/classes only — GameCanvas'
 * rendering logic is never touched, and no Three.js object is created here.
 *
 * The bubble is dismissible so it never fights the player for board space. It
 * is only folded away, not stopped: the tutorial keeps observing the run, and
 * completing a step (or starting the next one) brings it back automatically.
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
    !!tutorial.step &&
    !!store.level &&
    isTutorialLevelId(store.level.id),
);
/**
 * The bubble is open unless the player folded it away. A completed step always
 * re-opens it (the store enforces that), so this is only "hidden while working".
 */
const bubbleOpen = computed(() => visible.value && !tutorial.dismissed);

/** Step counter shared by the bubble and the collapsed chip. */
const counter = computed(() => tutorial.label);

const progressPct = computed(() => {
  const total = tutorial.total || 1;
  return Math.round(((tutorial.state.stepIndex + 1) / total) * 100);
});

function onNext(): void {
  tutorial.next();
}

function onSkip(): void {
  tutorial.skip();
}

/** Close the coach for now; observation keeps running behind it. */
function onDismiss(): void {
  tutorial.dismiss();
}

/** Re-open from the collapsed chip. */
function onReopen(): void {
  tutorial.reopen();
}
</script>

<template>
  <Transition name="tut">
    <div v-if="visible" class="tutorial" role="region" aria-label="新手教程">
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

      <!-- Collapsed chip: the only thing on screen after 收起. Click to reopen. -->
      <button
        v-if="!bubbleOpen"
        class="coach-chip"
        :class="{ cleared: tutorial.satisfied }"
        type="button"
        :aria-label="`重新打开新手教程（${counter}）`"
        @click="onReopen"
      >
        <span class="chip-dot" aria-hidden="true">{{ tutorial.satisfied ? '✔' : '?' }}</span>
        <span class="chip-label">教程 {{ counter }}</span>
      </button>

      <div v-if="bubbleOpen" class="bubble" :class="{ cleared: tutorial.satisfied }">
        <header>
          <span class="kicker">新手教程</span>
          <span class="counter">{{ tutorial.label }}</span>
          <button
            class="close"
            type="button"
            title="收起教程（完成本步后会再次弹出）"
            aria-label="收起新手教程"
            @click="onDismiss"
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
          <!-- Skip is always available; 下一步 unlocks only once the engine event
               for this step fired, so progression stays event-driven. -->
          <button class="ghost" @click="onSkip">跳过教程</button>
          <button class="primary" :disabled="!tutorial.satisfied" @click="onNext">
            {{ tutorial.isLastStep ? '完成' : '下一步' }}
          </button>
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
.bubble {
  position: absolute;
  left: clamp(1rem, 4vw, 2.4rem);
  bottom: clamp(5.6rem, 12vh, 8rem);
  width: min(390px, calc(100vw - 2rem));
  pointer-events: auto;
  padding: 0.95rem 1.05rem 0.85rem;
  border-radius: 15px;
  border: 1px solid rgba(127, 233, 255, 0.28);
  background: linear-gradient(160deg, rgba(16, 30, 42, 0.96), rgba(9, 15, 21, 0.96));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  color: #e3f0f8;
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
  justify-content: space-between;
  gap: 0.5rem;
}
.actions button {
  padding: 0.42rem 0.85rem;
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
.actions button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.actions button.ghost {
  color: #93aec0;
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
@media (max-width: 720px) {
  .bubble {
    left: 0.6rem;
    right: 0.6rem;
    width: auto;
    bottom: 5.4rem;
  }
  .coach-chip {
    top: 0.55rem;
  }
}
</style>
