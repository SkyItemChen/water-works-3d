<script setup lang="ts">
/**
 * PauseOverlay — pause menu, settings toggles, controls reference.
 */
import { computed } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTutorialStore } from '@/stores/tutorialStore';

const store = useGameStore();
const settings = useSettingsStore();
const tutorial = useTutorialStore();

const level = computed(() => store.level);

function resume(): void {
  store.setPaused(false);
}

function restart(): void {
  store.restart();
}

function quit(): void {
  // Leaving a tutorial run must also stop the coach, otherwise the overlay
  // would follow the player into contract levels.
  if (tutorial.running) {
    tutorial.quitTutorial();
    return;
  }
  store.toMenu();
}
</script>

<template>
  <Transition name="fade">
    <div class="overlay" v-if="store.paused" @click.self="resume">
      <div class="card">
        <span class="kicker">已暂停</span>
        <h2>{{ level?.name ?? '游戏' }}</h2>
        <p class="desc">水会等你回来。检查一下水位、危险列和下一块。</p>

        <div class="settings">
          <label class="toggle">
            <input type="checkbox" v-model="settings.showPreview" />
            <span>三步水流预览</span>
            <em>默认开</em>
          </label>
          <label class="toggle">
            <input type="checkbox" v-model="settings.muted" />
            <span>静音</span>
            <em>M</em>
          </label>
          <label class="toggle">
            <input type="checkbox" v-model="settings.reducedMotion" />
            <span>减少镜头运动</span>
            <em>晕动症友好</em>
          </label>
        </div>

        <div class="controls">
          <div><kbd>←</kbd><kbd>→</kbd><span>移动</span></div>
          <div><kbd>↑</kbd><kbd>X</kbd><span>旋转</span></div>
          <div><kbd>↓</kbd><span>软降</span></div>
          <div><kbd>空格</kbd><span>硬降</span></div>
          <div><kbd>Shift</kbd><span>保留</span></div>
          <div><kbd>R</kbd><span>重开</span></div>
          <div><kbd>V</kbd><span>预览开关</span></div>
          <div><kbd>Q</kbd><kbd>E</kbd><span>转视角</span></div>
        </div>

        <div class="actions">
          <button class="primary" @click="resume">继续游戏</button>
          <button @click="restart">重开本关</button>
          <button class="ghost" @click="quit">返回主菜单</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgba(5, 9, 13, 0.72);
  backdrop-filter: blur(5px);
}
.card {
  width: min(460px, 92vw);
  background: linear-gradient(165deg, #101d29, #0a121a);
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 18px;
  padding: 1.4rem 1.5rem;
  color: #e9f2f8;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.kicker {
  font-size: 0.66rem;
  letter-spacing: 0.18em;
  color: #ffb75e;
  text-transform: uppercase;
}
h2 {
  margin: 0.35rem 0 0.3rem;
  font-size: 1.35rem;
}
.desc {
  margin: 0 0 1rem;
  color: #8fa9bd;
  font-size: 0.82rem;
  line-height: 1.5;
}
.settings {
  display: grid;
  gap: 0.4rem;
  margin-bottom: 1rem;
}
.toggle {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.6rem;
  align-items: center;
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(120, 190, 230, 0.12);
  font-size: 0.82rem;
  cursor: pointer;
}
.toggle em {
  color: #6d8394;
  font-style: normal;
  font-size: 0.66rem;
}
.controls {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.32rem 0.7rem;
  margin-bottom: 1.1rem;
  font-size: 0.72rem;
  color: #9fb8c9;
}
.controls div {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
kbd {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.64rem;
  padding: 0.12rem 0.3rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #d7e7f2;
}
.controls span {
  margin-left: 0.2rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
button {
  flex: 1;
  min-width: 100px;
  padding: 0.62rem 0.8rem;
  border-radius: 10px;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: rgba(255, 255, 255, 0.05);
  color: #d7e7f2;
  font-size: 0.84rem;
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
  box-shadow: 0 6px 20px rgba(42, 157, 196, 0.35);
}
button.ghost {
  background: transparent;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
