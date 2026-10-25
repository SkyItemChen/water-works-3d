<script setup lang="ts">
/**
 * TouchControls — mobile buttons wired to the same engine actions as keyboard.
 * Visible only on coarse pointers or narrow screens.
 *
 * Besides the six piece controls it carries the two "meta" actions that a
 * phone has no keyboard for: pause and restart. They are deliberately part of
 * this bar rather than free-floating buttons, so they cannot end up underneath
 * the canvas/HUD hit areas.
 *
 * Meta buttons fire on `click`, not on `pointerdown`. On a touch screen the
 * browser still synthesizes a click after the finger lifts; if a button already
 * acted on `pointerdown`, that trailing click lands on whatever appeared under
 * the finger — for pause, the newly-mounted overlay, whose `click.self`
 * immediately resumed the game. `click` is also what screen readers and
 * keyboards dispatch, so it is the correct activation event for a control.
 */
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useTutorialStore } from '@/stores/tutorialStore';

const store = useGameStore();
const tutorial = useTutorialStore();
const emit = defineEmits<{ (e: 'camera', dir: 'left' | 'right' | 'reset'): void }>();

/** Piece actions only: pause/restart stay usable while the run is not playing. */
const disabled = computed(() => store.paused || store.showResult || !store.engine || store.engine.status !== 'playing');

function press(a: 'L' | 'R' | 'C' | 'A' | 'D' | 'H'): void {
  store.audio.init();
  store.dispatch(a);
}

/** Restart the current run. Mirrors the keyboard's R and the pause-menu button. */
function restart(): void {
  store.audio.init();
  store.restart();
}

/** Pause / resume; kept here because touch devices have no Esc key. */
function togglePause(): void {
  store.audio.init();
  store.togglePause();
}

/**
 * Resume from the pause overlay. The overlay sits above the touch bar, so the
 * bar's own pause button cannot be reached while paused — the overlay owns
 * `继续游戏`. This handler exists for symmetry and for keyboards/AT that can
 * still activate the bar.
 */
function resume(): void {
  store.audio.init();
  store.setPaused(false);
}
</script>

<template>
  <div class="touch-controls">
    <div class="group left" :class="{ disabled }">
      <button class="tc" @pointerdown.prevent="press('L')" aria-label="左移">←</button>
      <button class="tc" @pointerdown.prevent="press('R')" aria-label="右移">→</button>
      <button class="tc" @pointerdown.prevent="press('D')" aria-label="软降">↓</button>
    </div>

    <div class="group meta">
      <button
        class="tc meta-btn"
        type="button"
        aria-label="重新开始本关"
        title="重新开始本关"
        @click="restart"
      >
        <span class="glyph" aria-hidden="true">↻</span>
        <span class="cap">重开</span>
      </button>
      <button
        class="tc meta-btn"
        type="button"
        :aria-label="store.paused ? '继续游戏' : '暂停游戏'"
        :title="store.paused ? '继续游戏' : '暂停游戏'"
        @click="store.paused ? resume() : togglePause()"
      >
        <span class="glyph" aria-hidden="true">{{ store.paused ? '▶' : '❚❚' }}</span>
        <span class="cap">{{ store.paused ? '继续' : '暂停' }}</span>
      </button>
    </div>

    <div class="group right" :class="{ disabled }">
      <button class="tc accent" @pointerdown.prevent="press('C')" aria-label="旋转">⟳</button>
      <button class="tc hold" @pointerdown.prevent="press('H')" aria-label="保留">H</button>
      <button class="tc drop" @pointerdown.prevent="press('A')" aria-label="硬降">⤓</button>
    </div>
  </div>
</template>

<style scoped>
.touch-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: max(0.7rem, env(safe-area-inset-bottom));
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0 0.6rem;
  z-index: 20;
  pointer-events: none;
}
.group {
  display: flex;
  gap: 0.4rem;
  pointer-events: auto;
}
/* Piece controls dim/lock while paused or after the run ends; the meta group
   (pause / restart) must stay interactive in exactly those states. */
.group.disabled {
  opacity: 0.35;
  pointer-events: none;
}
.tc {
  width: 3.4rem;
  height: 3.4rem;
  border-radius: 16px;
  border: 1px solid rgba(120, 190, 230, 0.28);
  background: rgba(13, 24, 33, 0.82);
  color: #d3e9f7;
  font-size: 1.25rem;
  font-weight: 600;
  backdrop-filter: blur(6px);
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.08s ease, background 0.12s ease;
}
.tc:active {
  transform: scale(0.93);
  background: rgba(42, 157, 196, 0.35);
}
.tc.accent {
  border-color: rgba(255, 200, 87, 0.4);
  color: #ffd98a;
}
.tc.hold {
  border-color: rgba(242, 182, 198, 0.4);
  color: #ffc9d8;
  font-size: 0.95rem;
}
.tc.drop {
  border-color: rgba(127, 233, 255, 0.45);
  color: #9be8ff;
  background: rgba(22, 60, 78, 0.85);
}
.meta {
  gap: 0.35rem;
}
.meta-btn {
  width: 3rem;
  height: 2.6rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.05rem;
  border-radius: 12px;
  border-color: rgba(255, 183, 94, 0.32);
  background: rgba(20, 26, 31, 0.86);
  color: #ffd28a;
}
.meta-btn:active {
  background: rgba(255, 183, 94, 0.22);
}
.meta-btn .glyph {
  font-size: 1rem;
  line-height: 1;
}
.meta-btn .cap {
  font-size: 0.56rem;
  letter-spacing: 0.04em;
  color: #b9c9d4;
}
/* Eight controls in one row need ~430 px (the 6 piece buttons at 3.4rem plus
   2 meta buttons and gaps). Below that, split into two rows — meta above,
   piece controls below — instead of shrinking or clipping a touch target. */
@media (max-width: 460px) {
  .touch-controls {
    flex-wrap: wrap;
    row-gap: 0.3rem;
  }
  .group.meta {
    order: -1;
    flex-basis: 100%;
    justify-content: flex-end;
  }
}
@media (min-width: 421px) and (max-width: 460px) {
  /* Keep full-size targets on the wrapped row. */
  .group.left,
  .group.right {
    flex: 1;
  }
  .group.right {
    justify-content: flex-end;
  }
}

/* 44 px is the smallest touch target we are willing to ship; below that,
   players start missing the hard drop. */
@media (max-width: 420px) {
  .touch-controls {
    padding: 0 0.3rem;
    gap: 0;
  }
  .group {
    gap: 0.15rem;
  }
  .tc {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 12px;
    font-size: 1.1rem;
  }
  .meta-btn {
    width: 2.75rem;
    height: 2.75rem;
  }
  .meta-btn .cap {
    font-size: 0.5rem;
  }
  .meta-btn .glyph {
    font-size: 0.9rem;
  }
}
@media (hover: hover) and (pointer: fine) and (min-width: 900px) {
  .touch-controls {
    display: none;
  }
}
</style>
