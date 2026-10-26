<script setup lang="ts">
/**
 * AchievementToast — unlocks pop in the top-right and leave on their own.
 *
 * Reads the queue the progress store appends to on unlock, so the trigger lives
 * next to the rule that fired instead of being spread across screens.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useProgressStore } from '@/stores/progressStore';
import { achievementById } from '@/game/core/achievements';

interface Shown {
  id: string;
  name: string;
  desc: string;
}

const progress = useProgressStore();
const shown = ref<Shown[]>([]);
const timers: ReturnType<typeof setTimeout>[] = [];

function reveal(ids: string[]): void {
  for (const id of ids) {
    const def = achievementById(id);
    if (!def) continue;
    shown.value.push({ id, name: def.name, desc: def.desc });
    const timer = setTimeout(() => {
      shown.value = shown.value.filter((s) => s.id !== id);
    }, 4200);
    timers.push(timer);
  }
}

watch(
  () => progress.recentUnlocks.length,
  () => {
    const ids = progress.consumeUnlocks();
    if (ids.length) reveal(ids);
  },
);

onMounted(() => {
  // A queued unlock can exist before the toast mounts (first load of an old save).
  const ids = progress.consumeUnlocks();
  if (ids.length) reveal(ids);
});

onBeforeUnmount(() => {
  for (const t of timers) clearTimeout(t);
});
</script>

<template>
  <TransitionGroup name="toast" tag="div" class="toasts">
    <div v-for="item in shown" :key="item.id" class="toast">
      <span class="medal" aria-hidden="true">◆</span>
      <div>
        <b>成就解锁 · {{ item.name }}</b>
        <p>{{ item.desc }}</p>
      </div>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: 0.9rem;
  right: 0.9rem;
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  pointer-events: none;
  max-width: min(340px, 90vw);
}
.toast {
  display: flex;
  gap: 0.55rem;
  padding: 0.6rem 0.75rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 196, 106, 0.45);
  background: linear-gradient(160deg, rgba(46, 36, 20, 0.96), rgba(16, 12, 8, 0.96));
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  color: #f6ebd8;
}
.medal {
  color: #ffc274;
  font-size: 0.9rem;
  line-height: 1.3;
}
b {
  font-size: 0.75rem;
  letter-spacing: 0.02em;
}
p {
  margin: 0.12rem 0 0;
  font-size: 0.66rem;
  line-height: 1.45;
  color: #c6b393;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
</style>
