<script setup lang="ts">
/**
 * App shell: swaps screens, keeps the 3D canvas mounted only while in game.
 */
import { computed, onMounted } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useSettingsStore } from '@/stores/settingsStore';
import GameCanvas from '@/components/GameCanvas.vue';
import Hud from '@/components/Hud.vue';
import MainMenu from '@/components/MainMenu.vue';
import LevelSelect from '@/components/LevelSelect.vue';
import DailyChallenge from '@/components/DailyChallenge.vue';
import LevelEditor from '@/components/LevelEditor.vue';
import PauseOverlay from '@/components/PauseOverlay.vue';
import ResultOverlay from '@/components/ResultOverlay.vue';
import TouchControls from '@/components/TouchControls.vue';
import ReplayOverlay from '@/components/ReplayOverlay.vue';
import TutorialOverlay from '@/components/TutorialOverlay.vue';

const store = useGameStore();
const settings = useSettingsStore();

const inGame = computed(() => store.screen === 'game');
const showCanvas = computed(() => store.screen === 'game');
const showTouch = computed(() => store.screen === 'game' && !store.paused && !store.showResult);

onMounted(() => {
  store.audio.setMuted(settings.muted);
  // Unlock audio on the first interaction.
  const unlock = (): void => {
    store.audio.init();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
});
</script>

<template>
  <div class="app">
    <GameCanvas v-if="showCanvas" :active="inGame" />

    <Transition name="screen" mode="out-in">
      <MainMenu v-if="store.screen === 'menu'" key="menu" />
      <LevelSelect v-else-if="store.screen === 'levels'" key="levels" />
      <DailyChallenge v-else-if="store.screen === 'daily'" key="daily" />
      <LevelEditor v-else-if="store.screen === 'editor'" key="editor" />
      <ReplayOverlay v-else-if="store.screen === 'replay'" key="replay" />
    </Transition>

    <template v-if="inGame">
      <Hud />
      <TouchControls v-if="showTouch" />
      <TutorialOverlay />
      <PauseOverlay />
      <ResultOverlay />
    </template>
  </div>
</template>

<style scoped>
.app {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #070b10;
}
.screen-enter-active,
.screen-leave-active {
  transition: opacity 0.16s ease;
}
.screen-enter-from,
.screen-leave-to {
  opacity: 0;
}
</style>
