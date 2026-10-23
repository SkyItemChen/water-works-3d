<script setup lang="ts">
/**
 * TouchControls — mobile buttons wired to the same engine actions as keyboard.
 * Visible only on coarse pointers or narrow screens.
 */
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';

const store = useGameStore();
const emit = defineEmits<{ (e: 'camera', dir: 'left' | 'right' | 'reset'): void }>();

const disabled = computed(() => store.paused || store.showResult || !store.engine || store.engine.status !== 'playing');

function press(a: 'L' | 'R' | 'C' | 'A' | 'D' | 'H'): void {
  store.audio.init();
  store.dispatch(a);
}
</script>

<template>
  <div class="touch-controls" :class="{ disabled }">
    <div class="group left">
      <button class="tc" @pointerdown.prevent="press('L')" aria-label="左移">←</button>
      <button class="tc" @pointerdown.prevent="press('R')" aria-label="右移">→</button>
      <button class="tc" @pointerdown.prevent="press('D')" aria-label="软降">↓</button>
    </div>
    <div class="group right">
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
  justify-content: space-between;
  padding: 0 1rem;
  z-index: 20;
  pointer-events: none;
}
.touch-controls.disabled {
  opacity: 0.35;
  pointer-events: none;
}
.group {
  display: flex;
  gap: 0.5rem;
  pointer-events: auto;
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
@media (hover: hover) and (pointer: fine) and (min-width: 900px) {
  .touch-controls {
    display: none;
  }
}
</style>
