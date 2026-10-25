<script setup lang="ts">
/**
 * TutorialIntro — the tutorial's own landing page.
 *
 * It is the only place that offers 跳过教程: inside the steps there is nothing
 * to click but "close the prompt and play", because a step now advances by
 * itself once its goal is met. Painted above the main menu; purely
 * presentational, every action is a tutorial-store call.
 */
import { computed } from 'vue';
import { useTutorialStore } from '@/stores/tutorialStore';
import { tutorialLevels } from '@/game/core/level';

const tutorial = useTutorialStore();

const levels = computed(() => tutorialLevels());

function start(): void {
  tutorial.begin();
}

function skip(): void {
  tutorial.skip();
}

function back(): void {
  tutorial.quitTutorial();
}
</script>

<template>
  <Transition name="fade">
    <div v-if="tutorial.intro" class="overlay" @click.self="back">
      <div class="card">
        <button class="close" type="button" aria-label="返回主菜单" @click="back">×</button>
        <span class="kicker">新手教程</span>
        <h2>5 步看懂水厂</h2>
        <p class="desc">
          每步先读提示，关闭提示后水流才开始。达成目标会自动进入下一步，不需要点按钮。
        </p>

        <ol class="steps">
          <li v-for="(l, i) in levels" :key="l.id">
            <span class="n">{{ i + 1 }}</span>
            <span class="txt">
              <b>{{ l.tutorial?.title ?? l.name }}</b>
              <em>{{ l.subtitle ?? l.name }}</em>
            </span>
          </li>
        </ol>

        <div class="actions">
          <button class="ghost" type="button" @click="skip">跳过教程</button>
          <button class="primary" type="button" @click="start">开始教程</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  background: rgba(5, 9, 13, 0.72);
  backdrop-filter: blur(5px);
  overflow-y: auto;
  padding: 1rem;
}
.card {
  position: relative;
  width: min(460px, 92vw);
  background: linear-gradient(165deg, #101d29, #0a121a);
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 18px;
  padding: 1.4rem 1.5rem;
  color: #e9f2f8;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.card .close {
  position: absolute;
  top: 0.7rem;
  right: 0.75rem;
  width: 1.7rem;
  height: 1.7rem;
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
}
.card .close:hover {
  color: #eafaff;
  border-color: rgba(127, 233, 255, 0.5);
}
.kicker {
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #7fe9ff;
}
h2 {
  margin: 0.25rem 0 0.5rem;
  font-size: 1.3rem;
}
.desc {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  line-height: 1.7;
  color: #9fbccd;
}
.steps {
  list-style: none;
  margin: 0 0 1.2rem;
  padding: 0;
  display: grid;
  gap: 0.45rem;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.6rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(120, 190, 230, 0.12);
}
.steps .n {
  flex: 0 0 auto;
  width: 1.35rem;
  height: 1.35rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 0.68rem;
  font-weight: 700;
  color: #06202b;
  background: linear-gradient(135deg, #7fe9ff, #2a9dc4);
}
.steps .txt {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.steps b {
  font-size: 0.8rem;
  font-weight: 620;
}
.steps em {
  font-style: normal;
  font-size: 0.68rem;
  color: #8fa9bd;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}
.actions button {
  padding: 0.5rem 1rem;
  border-radius: 9px;
  font-size: 0.8rem;
  cursor: pointer;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: rgba(255, 255, 255, 0.05);
  color: #d7e7f2;
}
.actions button.primary {
  background: linear-gradient(135deg, #2a9dc4, #1a6f96);
  border-color: transparent;
  color: #eafaff;
  font-weight: 620;
}
.actions button.ghost {
  color: #93aec0;
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
