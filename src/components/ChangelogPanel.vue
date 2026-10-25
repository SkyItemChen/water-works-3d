<script setup lang="ts">
/**
 * ChangelogPanel — 更新日志.
 *
 * Read-only view over `core/changelog.ts`. It never touches the engine or the
 * stores: the version comes from `core/version.ts` (package.json, inlined at
 * build time), so there is exactly one place to bump a release.
 */
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { CHANGELOG, type ChangelogTag } from '@/game/core/changelog';
import { APP_VERSION } from '@/game/core/version';

const emit = defineEmits<{ close: [] }>();

const entries = computed(() => CHANGELOG);
const version = computed(() => APP_VERSION);

function tagClass(tag: ChangelogTag): string {
  if (tag === '新增') return 'add';
  if (tag === '改进') return 'imp';
  return 'fix';
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Transition name="fade">
    <div class="overlay" @click.self="emit('close')">
      <div class="card" role="dialog" aria-modal="true" aria-label="更新日志">
        <header>
          <span class="kicker">更新日志</span>
          <span class="current">v{{ version }}</span>
          <button class="close" type="button" aria-label="关闭更新日志" @click="emit('close')">×</button>
        </header>

        <div class="list">
          <section v-for="(entry, i) in entries" :key="entry.version" class="entry">
            <div class="entry-head">
              <b class="ver">v{{ entry.version }}</b>
              <span class="date">{{ entry.date }}</span>
              <span v-if="i === 0" class="badge">当前版本</span>
            </div>
            <h3>{{ entry.title }}</h3>
            <ul>
              <li v-for="(item, k) in entry.items" :key="k">
                <span class="tag" :class="tagClass(item.tag)">{{ item.tag }}</span>
                <span class="text">{{ item.text }}</span>
              </li>
            </ul>
          </section>
        </div>

        <footer class="foot">版本号来自 package.json · 纯单机，无网络请求</footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Fixed, not absolute: the menu is the scroll container, and an absolute
   overlay would ride along with its content. */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(5, 9, 13, 0.74);
  backdrop-filter: blur(5px);
}
.card {
  width: min(520px, 94vw);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(165deg, #101d29, #0a121a);
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 18px;
  padding: 1.15rem 1.3rem 0.9rem;
  color: #e9f2f8;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.card header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid rgba(120, 190, 230, 0.12);
}
.kicker {
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #7fe9ff;
}
.current {
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: #9fbccd;
}
.card header .close {
  margin-left: auto;
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
.card header .close:hover {
  color: #eafaff;
  border-color: rgba(127, 233, 255, 0.5);
}
.list {
  overflow-y: auto;
  padding-right: 0.2rem;
}
.entry {
  padding: 0.85rem 0 0.8rem;
  border-bottom: 1px dashed rgba(120, 190, 230, 0.12);
}
.entry:last-child {
  border-bottom: 0;
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.ver {
  font-size: 0.92rem;
  font-variant-numeric: tabular-nums;
}
.date {
  font-size: 0.68rem;
  color: #6d8399;
  font-variant-numeric: tabular-nums;
}
.badge {
  margin-left: auto;
  padding: 0.06rem 0.4rem;
  border-radius: 999px;
  font-size: 0.58rem;
  font-weight: 700;
  color: #08221a;
  background: linear-gradient(135deg, #7ee2a8, #4ecf8a);
}
.entry h3 {
  margin: 0.3rem 0 0.45rem;
  font-size: 0.84rem;
  font-weight: 600;
  color: #cfe4f1;
}
.entry ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.entry li {
  display: flex;
  gap: 0.5rem;
  font-size: 0.74rem;
  line-height: 1.65;
  color: #a9c1d1;
}
.tag {
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: 0.18rem;
  padding: 0.02rem 0.34rem;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.tag.add {
  color: #08221a;
  background: rgba(126, 226, 168, 0.85);
}
.tag.imp {
  color: #06202b;
  background: rgba(127, 233, 255, 0.8);
}
.tag.fix {
  color: #2b1a06;
  background: rgba(255, 200, 87, 0.85);
}
.text {
  min-width: 0;
}
.foot {
  padding-top: 0.6rem;
  border-top: 1px solid rgba(120, 190, 230, 0.12);
  font-size: 0.62rem;
  color: #55697a;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (max-width: 640px) {
  .card {
    padding: 0.95rem 1rem 0.8rem;
  }
  .entry li {
    font-size: 0.72rem;
  }
}
</style>
