<script setup lang="ts">
/**
 * ShareCodePanel — import a share code, browse local history, copy entries.
 */
import { ref, computed } from 'vue';
import { copyToClipboard, decodeShareCode } from '@/game/core/shareCode';
import { useGameStore } from '@/stores/gameStore';
import { useProgressStore } from '@/stores/progressStore';

const store = useGameStore();
const progress = useProgressStore();

const input = ref('');
const message = ref('');
const error = ref('');
const busy = ref(false);

const emit = defineEmits<{ (e: 'loaded'): void }>();

const history = computed(() => progress.shareHistory);

async function importCode(): Promise<void> {
  error.value = '';
  message.value = '';
  busy.value = true;
  try {
    const decoded = decodeShareCode(input.value);
    if (!decoded.ok) {
      error.value = decoded.error ?? '短码无效';
      return;
    }
    const res = store.loadReplayCode(input.value);
    if (!res.ok) {
      error.value = res.error ?? '无法加载回放';
      return;
    }
    message.value = `已载入 ${decoded.levelName ?? decoded.payload?.l} 的回放`;
    emit('loaded');
  } finally {
    busy.value = false;
  }
}

async function copy(code: string): Promise<void> {
  const ok = await copyToClipboard(code);
  message.value = ok ? '已复制' : '复制失败，请手动选择';
}
</script>

<template>
  <div class="share-panel">
    <div class="import">
      <input
        v-model="input"
        placeholder="粘贴短码，例如 WW3-ABxxxxxx"
        spellcheck="false"
        @keydown.enter="importCode"
      />
      <button class="primary" :disabled="busy || !input.trim()" @click="importCode">载入回放</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="message" class="ok">{{ message }}</p>

    <div class="history">
      <h3>本地短码历史</h3>
      <p class="hint">最近 30 条。点击任意条目可复制。</p>
      <ul v-if="history.length">
        <li v-for="h in history" :key="h.code">
          <button class="row" @click="copy(h.code)">
            <span class="lvl">{{ h.levelName }}</span>
            <span class="score">{{ h.score }}</span>
            <code>{{ h.code.slice(0, 18) }}…</code>
            <span class="date">{{ new Date(h.date).toLocaleDateString('zh-CN') }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="empty">还没有分享码。通关一关就会自动生成。</p>
    </div>
  </div>
</template>

<style scoped>
.share-panel {
  display: grid;
  gap: 0.6rem;
}
.import {
  display: flex;
  gap: 0.5rem;
}
.import input {
  flex: 1;
  min-width: 0;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 9px;
  padding: 0.55rem 0.7rem;
  color: #cdefff;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.76rem;
}
.import input:focus {
  outline: none;
  border-color: rgba(127, 233, 255, 0.5);
}
button.primary {
  padding: 0.55rem 0.9rem;
  border-radius: 9px;
  border: none;
  background: linear-gradient(135deg, #2a9dc4, #1a6f96);
  color: #eafaff;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
button.primary:disabled {
  opacity: 0.45;
  cursor: default;
}
.err {
  color: #ff9ba3;
  font-size: 0.72rem;
  margin: 0;
}
.ok {
  color: #8ef0b6;
  font-size: 0.72rem;
  margin: 0;
}
.history h3 {
  margin: 0.4rem 0 0.15rem;
  font-size: 0.8rem;
}
.hint {
  margin: 0 0 0.45rem;
  font-size: 0.66rem;
  color: #7d94a5;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.28rem;
  max-height: 240px;
  overflow-y: auto;
}
.row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 0.1rem 0.6rem;
  text-align: left;
  padding: 0.42rem 0.6rem;
  border-radius: 8px;
  border: 1px solid rgba(120, 190, 230, 0.12);
  background: rgba(255, 255, 255, 0.035);
  color: #c6d8e5;
  cursor: pointer;
  font: inherit;
}
.row:hover {
  border-color: rgba(127, 233, 255, 0.4);
  background: rgba(127, 233, 255, 0.07);
}
.lvl {
  font-size: 0.74rem;
}
.score {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  color: #ffd28a;
  font-size: 0.9rem;
  font-weight: 600;
}
code {
  font-size: 0.64rem;
  color: #6fa8c4;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.date {
  font-size: 0.6rem;
  color: #6d8394;
}
.empty {
  color: #7d94a5;
  font-size: 0.76rem;
}
</style>
