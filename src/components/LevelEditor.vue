<script setup lang="ts">
/**
 * LevelEditor — read-only / export preview of the level data model (P2 hook).
 * Supports load-JSON, local editing of the drain list and export of a shareable
 * level JSON. Full in-game painting is intentionally out of scope for MVP.
 */
import { computed, ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { contractLevels, exportLevelJson, importLevelJson, makeEmptyLevel, validateLevel } from '@/game/core/level';
import { copyToClipboard } from '@/game/core/shareCode';
import type { LevelDefinition } from '@/game/core/types';

const store = useGameStore();
const draft = ref<LevelDefinition>(makeEmptyLevel('draft-1'));
const status = ref('');
const jsonText = ref('');
const selected = ref('');

const levels = computed(() => contractLevels());
const errors = computed(() => validateLevel(draft.value));

function loadExample(id: string): void {
  const l = levels.value.find((x) => x.id === id);
  if (!l) return;
  draft.value = JSON.parse(JSON.stringify(l)) as LevelDefinition;
  selected.value = id;
  jsonText.value = exportLevelJson(draft.value);
  status.value = `已载入 ${l.name}（只读预览）`;
}

function loadJson(): void {
  try {
    draft.value = importLevelJson(jsonText.value);
    status.value = 'JSON 解析成功';
  } catch (e) {
    status.value = `JSON 解析失败：${(e as Error).message}`;
  }
}

async function copyJson(): Promise<void> {
  const ok = await copyToClipboard(exportLevelJson(draft.value));
  status.value = ok ? '关卡 JSON 已复制' : '复制失败';
}

function back(): void {
  store.toMenu();
}

const previewCells = computed(() => {
  const d = draft.value;
  const out: { x: number; y: number; kind: string }[] = [];
  for (const t of d.terrain) out.push({ x: t.x, y: t.y, kind: t.m });
  for (const dr of d.drains) out.push({ x: dr.x, y: dr.y, kind: dr.kind === 'clean' ? 'drainClean' : 'drainDirty' });
  return out;
});
</script>

<template>
  <div class="editor">
    <header class="head">
      <button class="back" @click="back">← 返回</button>
      <div>
        <span class="kicker">关卡编辑器 · 预览版</span>
        <h1>数据结构与导出</h1>
        <p>MVP 提供只读预览 + JSON 导入导出；完整摆放编辑会在后续更新加入。</p>
      </div>
    </header>

    <div class="body">
      <section class="panel left">
        <h2>载入示例</h2>
        <div class="examples">
          <button v-for="l in levels" :key="l.id" :class="{ on: selected === l.id }" @click="loadExample(l.id)">
            {{ String(l.index).padStart(2, '0') }} {{ l.name }}
          </button>
        </div>

        <h2>关卡属性</h2>
        <div class="fields">
          <label><span>名称</span><input v-model="draft.name" /></label>
          <label><span>子标题</span><input v-model="draft.subtitle" /></label>
          <label><span>种子</span><input type="number" v-model.number="draft.seed" /></label>
          <label><span>列</span><input type="number" v-model.number="draft.cols" /></label>
          <label><span>行</span><input type="number" v-model.number="draft.rows" /></label>
          <label><span>块数上限</span><input type="number" v-model.number="draft.blockLimit" /></label>
          <label><span>三星块数</span><input type="number" v-model.number="draft.star3Blocks" /></label>
        </div>

        <h2>校验</h2>
        <p v-if="errors.length" class="err">
          <span v-for="e in errors" :key="e">• {{ e }}</span>
        </p>
        <p v-else class="ok">✔ 结构有效</p>
      </section>

      <section class="panel mid">
        <h2>布局预览</h2>
        <div class="mini-grid" :style="{ '--cols': draft.cols, '--rows': draft.rows }">
          <template v-for="y in draft.rows" :key="'r' + y">
            <div
              v-for="x in draft.cols"
              :key="`${x}-${y}`"
              class="cell"
              :class="previewCells.find((c) => c.x === x - 1 && c.y === y - 1)?.kind ?? 'empty'"
            ></div>
          </template>
        </div>
        <div class="legend">
          <span class="sw soil"></span>土壤
          <span class="sw sand"></span>沙
          <span class="sw sponge"></span>海绵
          <span class="sw pipe"></span>管道
          <span class="sw drainClean"></span>清水口
          <span class="sw drainDirty"></span>污水口
        </div>
        <div class="terrain-list">
          <span>地形 {{ draft.terrain.length }} 格 · 排水口 {{ draft.drains.length }} 个 · 块池 {{ draft.pool.join(', ') }}</span>
        </div>
      </section>

      <section class="panel right">
        <h2>JSON 导入 / 导出</h2>
        <textarea v-model="jsonText" spellcheck="false" placeholder="粘贴关卡 JSON"></textarea>
        <div class="actions">
          <button @click="jsonText = exportLevelJson(draft)">导出到文本框</button>
          <button @click="loadJson">从文本框载入</button>
          <button class="primary" @click="copyJson">复制 JSON</button>
        </div>
        <p class="status">{{ status }}</p>
        <p class="hint">
          数据模型已支持 60 关、任意行列、任意块池与目标组合。未来的编辑器会在此基础上加入拖拽画布。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.editor {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 1.2rem clamp(0.8rem, 3vw, 2.4rem) 2.5rem;
  background: radial-gradient(circle at 10% 0%, rgba(127, 233, 255, 0.1), transparent 40%), #080d12;
  color: #e9f2f8;
  z-index: 30;
}
.head {
  display: flex;
  gap: 1rem;
  align-items: start;
  margin-bottom: 1rem;
}
.back {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(120, 190, 230, 0.2);
  color: #cfe4f2;
  border-radius: 9px;
  padding: 0.45rem 0.7rem;
  font-size: 0.78rem;
  cursor: pointer;
}
.kicker {
  font-size: 0.64rem;
  letter-spacing: 0.16em;
  color: #9be8ff;
  text-transform: uppercase;
}
h1 {
  margin: 0.15rem 0 0.2rem;
  font-size: 1.4rem;
}
.head p {
  margin: 0;
  font-size: 0.76rem;
  color: #8fa9bd;
}
.body {
  display: grid;
  grid-template-columns: minmax(230px, 1fr) minmax(240px, 1.2fr) minmax(260px, 1.1fr);
  gap: 0.9rem;
  align-items: start;
}
.panel {
  background: linear-gradient(160deg, rgba(20, 34, 46, 0.9), rgba(10, 17, 24, 0.9));
  border: 1px solid rgba(120, 190, 230, 0.16);
  border-radius: 14px;
  padding: 0.9rem;
}
h2 {
  margin: 0 0 0.45rem;
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7fa6bf;
}
h2:not(:first-child) {
  margin-top: 0.9rem;
}
.examples {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  max-height: 190px;
  overflow-y: auto;
}
.examples button {
  text-align: left;
  padding: 0.34rem 0.5rem;
  border-radius: 7px;
  border: 1px solid rgba(120, 190, 230, 0.12);
  background: rgba(255, 255, 255, 0.03);
  color: #b9cbd8;
  font-size: 0.72rem;
  cursor: pointer;
}
.examples button.on {
  border-color: rgba(127, 233, 255, 0.45);
  background: rgba(127, 233, 255, 0.1);
  color: #9be8ff;
}
.fields {
  display: grid;
  gap: 0.3rem;
}
.fields label {
  display: grid;
  grid-template-columns: 5.2rem 1fr;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.68rem;
  color: #8fa9bd;
}
.fields input {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(120, 190, 230, 0.18);
  border-radius: 6px;
  color: #d7e7f2;
  padding: 0.28rem 0.4rem;
  font-size: 0.72rem;
  min-width: 0;
}
.err {
  margin: 0;
  display: grid;
  gap: 0.15rem;
  color: #ff9ba3;
  font-size: 0.66rem;
}
.ok {
  margin: 0;
  color: #8ef0b6;
  font-size: 0.7rem;
}
.mini-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), 1fr);
  grid-template-rows: repeat(var(--rows), 1fr);
  gap: 1px;
  background: rgba(120, 190, 230, 0.1);
  border: 1px solid rgba(120, 190, 230, 0.16);
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: calc(var(--cols) / var(--rows));
  max-height: 360px;
  margin: 0 auto;
}
.cell {
  background: rgba(255, 255, 255, 0.02);
  aspect-ratio: 1;
}
.cell.soil {
  background: #8a5a3b;
}
.cell.sand {
  background: #d8bd83;
}
.cell.sponge {
  background: #f2b6c6;
}
.cell.pipe {
  background: #9aa7b4;
}
.cell.valve {
  background: #ffc857;
}
.cell.filter {
  background: #a8e6cf;
}
.cell.ice {
  background: #bfeaff;
}
.cell.drainClean {
  background: #35d0a0;
  box-shadow: inset 0 0 0 1px #b8ffe4;
}
.cell.drainDirty {
  background: #c06b3f;
  box-shadow: inset 0 0 0 1px #ffcfae;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-top: 0.5rem;
  font-size: 0.62rem;
  color: #8fa9bd;
}
.sw {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 2px;
  display: inline-block;
  margin-right: 0.1rem;
}
.sw.soil {
  background: #8a5a3b;
}
.sw.sand {
  background: #d8bd83;
}
.sw.sponge {
  background: #f2b6c6;
}
.sw.pipe {
  background: #9aa7b4;
}
.sw.drainClean {
  background: #35d0a0;
}
.sw.drainDirty {
  background: #c06b3f;
}
.terrain-list {
  margin-top: 0.5rem;
  font-size: 0.62rem;
  color: #6d8394;
  word-break: break-all;
}
textarea {
  width: 100%;
  height: 250px;
  resize: vertical;
  background: rgba(0, 0, 0, 0.34);
  border: 1px solid rgba(120, 190, 230, 0.2);
  border-radius: 8px;
  color: #cdefff;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.66rem;
  padding: 0.5rem;
  line-height: 1.45;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
}
.actions button {
  padding: 0.35rem 0.6rem;
  border-radius: 7px;
  border: 1px solid rgba(120, 190, 230, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: #c6d8e5;
  font-size: 0.7rem;
  cursor: pointer;
}
.actions button.primary {
  background: linear-gradient(135deg, #2a9dc4, #1a6f96);
  border-color: transparent;
  color: #eafaff;
}
.status {
  margin: 0.45rem 0 0;
  font-size: 0.68rem;
  color: #9be8ff;
}
.hint {
  margin: 0.5rem 0 0;
  font-size: 0.64rem;
  line-height: 1.5;
  color: #6d8394;
}
@media (max-width: 980px) {
  .body {
    grid-template-columns: 1fr;
  }
}
</style>
