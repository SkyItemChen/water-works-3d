<script setup lang="ts">
/**
 * LevelEditor — full in-browser level authoring.
 *
 * The draft is a normal LevelDefinition, so anything authored here can be
 * exported as JSON and played by the same deterministic engine. Every paint
 * operation goes through the pure helpers in core/editor.ts; the view only owns
 * selection, persistence and presentation state.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import { BLOCKS } from '@/game/core/bag';
import { contractLevels, exportLevelJson, importLevelJson, makeEmptyLevel } from '@/game/core/level';
import { copyToClipboard } from '@/game/core/shareCode';
import {
  EDITOR_BLOCK_KINDS,
  EDITOR_BRUSHES,
  DIRECTION_LABELS,
  addGoal,
  changeGoalType,
  clearCell,
  cloneLevel,
  drainLabel,
  normalizeEditorLevel,
  paintDrain,
  paintInitialWater,
  paintTerrain,
  removeGoal,
  resizeLevel,
  setPoolCount,
  validateEditorLevel,
  type EditorBrushId,
  type EditorTerrainMaterial,
} from '@/game/core/editor';
import type { BlockKind, Dir, GoalType, LevelDefinition } from '@/game/core/types';

const STORAGE_KEY = 'ww3d.level-editor.draft.v2';
const store = useGameStore();

const MATERIAL_COLORS: Record<EditorTerrainMaterial, string> = {
  soil: '#8a5a3b',
  sand: '#d8bd83',
  sponge: '#f2b6c6',
  pipe: '#9aa7b4',
  valve: '#ffc857',
  filter: '#a8e6cf',
  ice: '#bfeaff',
};

const GOAL_TYPES: { id: GoalType; label: string }[] = [
  { id: 'drainClean', label: '清水排水' },
  { id: 'drainDirty', label: '污水排水' },
  { id: 'waterline', label: '水位线' },
  { id: 'score', label: '得分' },
  { id: 'survive', label: '存活' },
];

const draft = ref<LevelDefinition>(restoreDraft());
const brushId = ref<EditorBrushId>('soil');
const direction = ref<Dir>(2);
const cellSize = ref(24);
const painting = ref(false);
const selectedExample = ref('');
const jsonText = ref(exportLevelJson(draft.value));
const status = ref('');
const lastSaved = ref('');
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const levels = computed(() => contractLevels());
const errors = computed(() => validateEditorLevel(draft.value));
const terrainBrushes = computed(() => EDITOR_BRUSHES.filter((b) => b.group === 'terrain'));
const markerBrushes = computed(() => EDITOR_BRUSHES.filter((b) => b.group === 'marker'));
const activeBrush = computed(() => EDITOR_BRUSHES.find((b) => b.id === brushId.value) ?? EDITOR_BRUSHES[0]);
const directional = computed(() => brushId.value === 'pipe' || brushId.value === 'valve');
const dirty = computed(() => errors.value.length > 0);
const goalDrains = computed(() => draft.value.drains);

interface CellView {
  x: number;
  y: number;
  terrain?: LevelDefinition['terrain'][number];
  drain?: LevelDefinition['drains'][number];
  water?: NonNullable<LevelDefinition['initialWater']>[number];
  drainName?: string;
  color: string;
  classes: string[];
  title: string;
}

const cells = computed<CellView[]>(() => {
  const d = draft.value;
  const terrain = new Map(d.terrain.map((t) => [`${t.x},${t.y}`, t]));
  const drains = new Map(d.drains.map((dr) => [`${dr.x},${dr.y}`, dr]));
  const water = new Map((d.initialWater ?? []).map((w) => [`${w.x},${w.y}`, w]));
  const out: CellView[] = [];
  for (let y = 0; y < d.rows; y++) {
    for (let x = 0; x < d.cols; x++) {
      const key = `${x},${y}`;
      const t = terrain.get(key);
      const dr = drains.get(key);
      const w = water.get(key);
      const classes = ['cell'];
      let color = 'rgba(255, 255, 255, 0.03)';
      let title = `${x + 1},${y + 1}`;
      if (t) {
        classes.push('has-terrain');
        color = MATERIAL_COLORS[t.m as EditorTerrainMaterial] ?? '#8a5a3b';
        title += ` · ${t.m}`;
      }
      if (dr) {
        classes.push('has-drain', dr.kind === 'clean' ? 'drain-clean' : 'drain-dirty');
        color = dr.kind === 'clean' ? '#35d0a0' : '#c06b3f';
        title += ` · ${dr.kind === 'clean' ? '清水口' : '污水口'}`;
      }
      if (w) {
        classes.push('has-water');
        color = (w.clean ?? 0) > 0 ? 'rgba(57, 197, 255, 0.4)' : 'rgba(111, 122, 51, 0.5)';
        title += ` · 初始${(w.clean ?? 0) > 0 ? '清水' : '污水'}`;
      }
      out.push({
        x,
        y,
        terrain: t,
        drain: dr,
        water: w,
        drainName: dr ? drainLabel(d.drains.indexOf(dr)) : undefined,
        color,
        classes,
        title,
      });
    }
  }
  return out;
});

function restoreDraft(): LevelDefinition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const restored = normalizeEditorLevel(JSON.parse(raw) as Partial<LevelDefinition>);
      if (restored.terrain.length || restored.goals.length) return restored;
    }
  } catch {
    // A corrupt draft should never block the editor from opening.
  }
  const blank = makeEmptyLevel('draft-1');
  blank.name = '未命名关卡';
  blank.terrain = [
    { x: 0, y: blank.rows - 1, m: 'soil' },
    { x: blank.cols - 1, y: blank.rows - 1, m: 'soil' },
  ];
  return blank;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, exportLevelJson(draft.value));
    lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    status.value = '浏览器拒绝了本地存储，请及时导出 JSON';
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist();
    saveTimer = null;
  }, 350);
}

watch(draft, scheduleSave, { deep: true });

function applyBrush(x: number, y: number): void {
  const id = brushId.value;
  if ((id === 'drainClean' || id === 'drainDirty') && y !== draft.value.rows - 1) {
    status.value = '排水口只能放在最底行';
    return;
  }
  if (id === 'erase') draft.value = clearCell(draft.value, x, y);
  else if (id === 'drainClean') draft.value = paintDrain(draft.value, x, y, 'clean');
  else if (id === 'drainDirty') draft.value = paintDrain(draft.value, x, y, 'dirty');
  else if (id === 'waterClean') draft.value = paintInitialWater(draft.value, x, y, 'clean');
  else if (id === 'waterDirty') draft.value = paintInitialWater(draft.value, x, y, 'dirty');
  else draft.value = paintTerrain(draft.value, x, y, id, direction.value);
}

function onCellDown(ev: PointerEvent, x: number, y: number): void {
  if (ev.button !== 0) return;
  painting.value = true;
  applyBrush(x, y);
}

function onCellEnter(ev: PointerEvent, x: number, y: number): void {
  if (!painting.value || (ev.buttons & 1) === 0) return;
  applyBrush(x, y);
}

function onCellKey(ev: KeyboardEvent, x: number, y: number): void {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  ev.preventDefault();
  applyBrush(x, y);
}

function stopPainting(): void {
  painting.value = false;
}

function rotateDir(): void {
  direction.value = ((direction.value + 1) % 4) as Dir;
}

function applySize(): void {
  draft.value = resizeLevel(draft.value, draft.value.cols, draft.value.rows);
}

function adjustPool(kind: BlockKind, delta: number): void {
  const count = draft.value.pool.filter((k) => k === kind).length;
  draft.value = setPoolCount(draft.value, kind, count + delta);
}

function poolCount(kind: BlockKind): number {
  return draft.value.pool.filter((k) => k === kind).length;
}

function addGoalRow(): void {
  draft.value = addGoal(draft.value);
}

function removeGoalRow(index: number): void {
  draft.value = removeGoal(draft.value, index);
}

function onGoalTypeChange(index: number, ev: Event): void {
  const type = (ev.target as HTMLSelectElement).value as GoalType;
  draft.value = changeGoalType(draft.value, index, type);
}

function goalLabel(type: GoalType): string {
  return GOAL_TYPES.find((g) => g.id === type)?.label ?? type;
}

function clearDrain(id: number): void {
  const drain = draft.value.drains.find((d) => d.id === id);
  if (!drain) return;
  draft.value = clearCell(draft.value, drain.x, drain.y);
}

function loadExample(): void {
  const source = levels.value.find((l) => l.id === selectedExample.value);
  if (!source) return;
  const copy = cloneLevel(source);
  copy.id = `draft-${source.id}`;
  copy.name = `${source.name} · 副本`;
  copy.index = 0;
  draft.value = copy;
  jsonText.value = exportLevelJson(copy);
  status.value = `已载入示例「${source.name}」，可直接修改`;
}

function newDraft(): void {
  const blank = makeEmptyLevel(`draft-${Date.now().toString(36)}`);
  blank.name = '未命名关卡';
  blank.terrain = [
    { x: 0, y: blank.rows - 1, m: 'soil' },
    { x: blank.cols - 1, y: blank.rows - 1, m: 'soil' },
  ];
  draft.value = blank;
  selectedExample.value = '';
  jsonText.value = exportLevelJson(blank);
  status.value = '已新建空白草稿';
}

function refreshJson(): void {
  jsonText.value = exportLevelJson(draft.value);
  status.value = '已生成当前关卡的 JSON';
}

function loadJson(): void {
  try {
    const parsed = normalizeEditorLevel(importLevelJson(jsonText.value));
    if (!parsed.id.startsWith('draft-')) parsed.id = `draft-${parsed.id}`;
    draft.value = parsed;
    selectedExample.value = '';
    status.value = 'JSON 已载入，可继续编辑';
  } catch (e) {
    status.value = `JSON 解析失败：${(e as Error).message}`;
  }
}

async function copyJson(): Promise<void> {
  jsonText.value = exportLevelJson(draft.value);
  const ok = await copyToClipboard(jsonText.value);
  status.value = ok ? '关卡 JSON 已复制' : '复制失败，请从文本框手动复制';
}

function downloadJson(): void {
  jsonText.value = exportLevelJson(draft.value);
  const blob = new Blob([jsonText.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${draft.value.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '-') || 'level'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  status.value = 'JSON 文件已下载';
}

function playtest(): void {
  if (errors.value.length) {
    status.value = `先修复 ${errors.value.length} 个校验问题再试玩`;
    return;
  }
  persist();
  store.startCustomLevel(cloneLevel(draft.value));
}

function back(): void {
  persist();
  store.toMenu();
}

onMounted(() => {
  window.addEventListener('pointerup', stopPainting);
  window.addEventListener('pointercancel', stopPainting);
});

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
  persist();
  window.removeEventListener('pointerup', stopPainting);
  window.removeEventListener('pointercancel', stopPainting);
});
</script>

<template>
  <div class="editor">
    <header class="head">
      <button class="back" @click="back">← 返回主菜单</button>
      <div class="head-main">
        <span class="kicker">关卡编辑器</span>
        <h1>{{ draft.name || '未命名关卡' }}</h1>
        <p>{{ draft.cols }} × {{ draft.rows }} · {{ draft.drains.length }} 个排水口 · {{ draft.goals.length }} 个目标 · {{ draft.pool.length }} 块池</p>
      </div>
      <div class="head-actions">
        <span class="save-state">{{ lastSaved ? `已自动保存 ${lastSaved}` : '自动保存' }}</span>
        <button @click="newDraft">新建</button>
        <button @click="refreshJson">导出 JSON</button>
        <button class="primary" :class="{ warn: dirty }" :title="errors.length ? errors[0] : '用当前草稿开一局'" @click="playtest">
          ▶ 试玩
        </button>
      </div>
    </header>

    <div class="body">
      <aside class="column left">
        <section class="panel">
          <h2>草稿</h2>
          <div class="example-row">
            <select v-model="selectedExample">
              <option value="">载入内置关卡作为模板…</option>
              <option v-for="l in levels" :key="l.id" :value="l.id">
                {{ String(l.index).padStart(2, '0') }} · {{ l.name }}
              </option>
            </select>
            <button :disabled="!selectedExample" @click="loadExample">载入</button>
          </div>
          <p class="subtle">载入只会复制为草稿，不会改动原有关卡或进度。</p>
        </section>

        <section class="panel">
          <h2>基本属性</h2>
          <div class="fields">
            <label><span>名称</span><input v-model="draft.name" maxlength="40" /></label>
            <label><span>副标题</span><input v-model="draft.subtitle" maxlength="80" /></label>
            <label><span>机制</span><input v-model="draft.mechanic" maxlength="40" /></label>
            <label class="wide"><span>简介</span><textarea v-model="draft.intro" rows="3" maxlength="400"></textarea></label>
            <label><span>种子</span><input v-model.number="draft.seed" type="number" /></label>
            <label><span>块数上限</span><input v-model.number="draft.blockLimit" type="number" min="1" /></label>
            <label><span>三星块数</span><input v-model.number="draft.star3Blocks" type="number" min="0" /></label>
            <label><span>下落间隔</span><input v-model.number="draft.fallInterval" type="number" min="1" /></label>
            <label><span>列数</span><input v-model.number="draft.cols" type="number" :min="4" :max="40" @change="applySize" /></label>
            <label><span>行数</span><input v-model.number="draft.rows" type="number" :min="6" :max="60" @change="applySize" /></label>
          </div>
        </section>

        <section class="panel validation" :class="{ bad: errors.length }">
          <h2>校验</h2>
          <p v-if="errors.length" class="err">
            <span v-for="e in errors" :key="e">• {{ e }}</span>
          </p>
          <p v-else class="ok">✔ 结构有效，可以试玩或导出</p>
        </section>
      </aside>

      <main class="column center">
        <section class="panel canvas-panel">
          <div class="toolbar-head">
            <div>
              <h2>画布</h2>
              <p class="subtle">左键/拖动绘制 · 排水口只能放在最底行 · 橡皮擦清除格子</p>
            </div>
            <div class="canvas-tools">
              <button v-if="directional" class="dir-btn" @click="rotateDir" :title="'旋转箭头（当前朝' + DIRECTION_LABELS[direction] + '）'">
                箭头 {{ DIRECTION_LABELS[direction] }} ↻
              </button>
              <label class="zoom">
                <span>格子</span>
                <input v-model.number="cellSize" type="range" min="14" max="34" step="1" />
              </label>
            </div>
          </div>

          <h3>地形画笔</h3>
          <div class="brushes">
            <button
              v-for="b in terrainBrushes"
              :key="b.id"
              class="brush"
              :class="{ on: brushId === b.id }"
              @click="brushId = b.id"
            >
              <i :style="{ background: b.color }"></i>{{ b.label }}
            </button>
          </div>

          <h3>标记与清除</h3>
          <div class="brushes">
            <button
              v-for="b in markerBrushes"
              :key="b.id"
              class="brush"
              :class="{ on: brushId === b.id, eraser: b.id === 'erase' }"
              @click="brushId = b.id"
            >
              <i :style="{ background: b.color }"></i>{{ b.label }}
            </button>
          </div>

          <div class="grid-wrap">
            <div class="grid" :style="{ '--cols': draft.cols, '--rows': draft.rows, '--cell': cellSize + 'px' }">
              <button
                v-for="cell in cells"
                :key="`${cell.x},${cell.y}`"
                class="cell"
                :class="cell.classes"
                type="button"
                :title="cell.title"
                :style="{ '--c': cell.color }"
                @pointerdown.prevent="onCellDown($event, cell.x, cell.y)"
                @pointerenter="onCellEnter($event, cell.x, cell.y)"
                @keydown="onCellKey($event, cell.x, cell.y)"
                @contextmenu.prevent
              >
                <span v-if="cell.drain" class="drain-mark">{{ cell.drainName }}</span>
                <span v-if="cell.water" class="water-mark"></span>
                <span
                  v-if="cell.terrain && (cell.terrain.m === 'pipe' || cell.terrain.m === 'valve')"
                  class="dir-mark"
                  :style="{ transform: `rotate(${((cell.terrain.dir ?? 2) * 90)}deg)` }"
                ></span>
              </button>
            </div>
          </div>

          <div class="canvas-foot">
            <span><b>{{ activeBrush.label }}</b> 画笔</span>
            <span>地形 {{ draft.terrain.length }} 格</span>
            <span>清水 {{ draft.initialWater?.filter((w) => (w.clean ?? 0) > 0).length ?? 0 }} 格</span>
            <span>污水 {{ draft.initialWater?.filter((w) => (w.dirty ?? 0) > 0).length ?? 0 }} 格</span>
          </div>
        </section>
      </main>

      <aside class="column right">
        <section class="panel">
          <div class="section-head">
            <h2>通关目标</h2>
            <button class="mini primary" @click="addGoalRow">＋ 目标</button>
          </div>
          <div v-if="!draft.goals.length" class="empty">还没有目标，至少添加一个才能试玩。</div>
          <div v-for="(g, i) in draft.goals" :key="i" class="goal-row">
            <select :value="g.type" @change="onGoalTypeChange(i, $event)">
              <option v-for="t in GOAL_TYPES" :key="t.id" :value="t.id">{{ t.label }}</option>
            </select>
            <template v-if="g.type === 'drainClean' || g.type === 'drainDirty'">
              <select v-model.number="g.drainId" class="drain-select">
                <option :value="-1">任意排水口</option>
                <option v-for="(d, di) in goalDrains" :key="d.id" :value="d.id">
                  {{ drainLabel(di) }} · {{ d.kind === 'clean' ? '清水' : '污水' }}
                </option>
              </select>
              <input v-model.number="g.amount" type="number" min="1" step="1" class="num" />
              <span class="unit">单位</span>
            </template>
            <template v-else-if="g.type === 'waterline'">
              <input v-model.number="g.row" type="number" min="0" :max="draft.rows - 1" class="num" />
              <span class="unit">水位行</span>
            </template>
            <template v-else-if="g.type === 'score'">
              <input v-model.number="g.value" type="number" min="1" step="10" class="num" />
              <span class="unit">分</span>
            </template>
            <span v-else class="unit">保持存活</span>
            <button class="remove" title="删除目标" @click="removeGoalRow(i)">×</button>
          </div>
        </section>

        <section class="panel">
          <h2>排水口</h2>
          <div v-if="!draft.drains.length" class="empty">用「清水口 / 污水口」画笔在底行放置。</div>
          <div v-for="(d, i) in draft.drains" :key="d.id" class="drain-row">
            <span class="badge" :class="d.kind">{{ drainLabel(i) }}</span>
            <span>{{ d.kind === 'clean' ? '清水口' : '污水口' }}</span>
            <span class="muted">第 {{ d.x + 1 }} 列</span>
            <button class="remove" title="删除排水口" @click="clearDrain(d.id)">×</button>
          </div>
        </section>

        <section class="panel">
          <h2>块池权重</h2>
          <p class="subtle">数量越多，7-bag 中出现的比例越高。0 表示不投放。</p>
          <div class="pool">
            <div v-for="kind in EDITOR_BLOCK_KINDS" :key="kind" class="pool-row">
              <i :style="{ background: BLOCKS[kind].color }"></i>
              <span class="pool-name">{{ BLOCKS[kind].name }}</span>
              <div class="stepper">
                <button @click="adjustPool(kind, -1)" :disabled="poolCount(kind) === 0">−</button>
                <b>{{ poolCount(kind) }}</b>
                <button @click="adjustPool(kind, 1)" :disabled="poolCount(kind) >= 9">＋</button>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>JSON 导入 / 导出</h2>
          <textarea v-model="jsonText" spellcheck="false" rows="9" placeholder="粘贴关卡 JSON"></textarea>
          <div class="actions">
            <button @click="refreshJson">生成</button>
            <button @click="loadJson">载入文本</button>
            <button @click="copyJson">复制</button>
            <button @click="downloadJson">下载 .json</button>
          </div>
        </section>

        <p v-if="status" class="status">{{ status }}</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.editor {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 1.1rem clamp(0.7rem, 2.4vw, 2rem) 2.5rem;
  background:
    radial-gradient(circle at 10% 0%, rgba(127, 233, 255, 0.1), transparent 38%),
    radial-gradient(circle at 92% 8%, rgba(255, 183, 94, 0.07), transparent 30%),
    #080d12;
  color: #e9f2f8;
  z-index: 30;
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 0.9rem;
  margin-bottom: 0.9rem;
}
.back {
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(120, 190, 230, 0.2);
  color: #cfe4f2;
  border-radius: 9px;
  padding: 0.45rem 0.7rem;
  font-size: 0.74rem;
  cursor: pointer;
}
.head-main {
  flex: 1 1 auto;
  min-width: 0;
}
.kicker {
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  color: #9be8ff;
  text-transform: uppercase;
}
h1 {
  margin: 0.1rem 0 0.15rem;
  font-size: clamp(1.2rem, 2.4vw, 1.55rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head p {
  margin: 0;
  font-size: 0.72rem;
  color: #8fa9bd;
}
.head-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.save-state {
  font-size: 0.62rem;
  color: #6d8394;
  margin-right: 0.2rem;
}
.head-actions button,
.actions button,
.example-row button,
.mini {
  padding: 0.42rem 0.65rem;
  border-radius: 8px;
  border: 1px solid rgba(120, 190, 230, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: #c6d8e5;
  font-size: 0.72rem;
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button.primary {
  background: linear-gradient(135deg, #2a9dc4, #1a6f96);
  border-color: transparent;
  color: #eafaff;
  font-weight: 650;
}
button.primary.warn {
  background: linear-gradient(135deg, #8f5a2a, #68401d);
}
.body {
  display: grid;
  grid-template-columns: minmax(230px, 0.82fr) minmax(380px, 1.55fr) minmax(290px, 1fr);
  gap: 0.75rem;
  align-items: start;
}
.column {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-width: 0;
}
.panel {
  background: linear-gradient(160deg, rgba(20, 34, 46, 0.9), rgba(10, 17, 24, 0.92));
  border: 1px solid rgba(120, 190, 230, 0.16);
  border-radius: 13px;
  padding: 0.78rem;
}
h2 {
  margin: 0 0 0.45rem;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7fa6bf;
}
h3 {
  margin: 0.65rem 0 0.3rem;
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  color: #6f8da2;
  text-transform: uppercase;
}
.subtle {
  margin: 0.3rem 0 0;
  font-size: 0.62rem;
  line-height: 1.5;
  color: #6d8394;
}
.example-row {
  display: flex;
  gap: 0.35rem;
}
.example-row select,
.fields input,
.goal-row select,
.goal-row input,
.fields textarea,
textarea {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(120, 190, 230, 0.18);
  border-radius: 6px;
  color: #d7e7f2;
  font-size: 0.7rem;
  min-width: 0;
}
.example-row select {
  flex: 1 1 auto;
  padding: 0.32rem 0.3rem;
}
.fields {
  display: grid;
  gap: 0.28rem;
}
.fields label {
  display: grid;
  grid-template-columns: 4.5rem 1fr;
  gap: 0.35rem;
  align-items: center;
  font-size: 0.66rem;
  color: #8fa9bd;
}
.fields label.wide {
  align-items: start;
}
.fields input,
.fields textarea {
  padding: 0.28rem 0.4rem;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}
.fields textarea {
  resize: vertical;
  line-height: 1.45;
}
.validation.bad {
  border-color: rgba(255, 120, 120, 0.35);
}
.err {
  margin: 0;
  display: grid;
  gap: 0.15rem;
  color: #ff9ba3;
  font-size: 0.64rem;
  line-height: 1.45;
}
.ok {
  margin: 0;
  color: #8ef0b6;
  font-size: 0.68rem;
}
.canvas-panel {
  padding: 0.78rem;
}
.toolbar-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: flex-start;
}
.canvas-tools {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.dir-btn {
  border: 1px solid rgba(255, 200, 87, 0.35);
  background: rgba(255, 200, 87, 0.1);
  color: #ffd28a;
  border-radius: 7px;
  padding: 0.28rem 0.45rem;
  font-size: 0.64rem;
  cursor: pointer;
  white-space: nowrap;
}
.zoom {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: #6d8394;
  font-size: 0.6rem;
  white-space: nowrap;
}
.zoom input {
  width: 72px;
}
.brushes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.brush {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.3rem 0.48rem 0.3rem 0.3rem;
  border-radius: 7px;
  border: 1px solid rgba(120, 190, 230, 0.14);
  background: rgba(255, 255, 255, 0.03);
  color: #b9cbd8;
  font-size: 0.66rem;
  cursor: pointer;
}
.brush i {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}
.brush:hover {
  border-color: rgba(127, 233, 255, 0.35);
}
.brush.on {
  border-color: rgba(127, 233, 255, 0.55);
  background: rgba(127, 233, 255, 0.1);
  color: #d9f6ff;
}
.brush.eraser i {
  border: 1px dashed #8299aa;
  background: transparent !important;
}
.grid-wrap {
  margin-top: 0.65rem;
  border: 1px solid rgba(120, 190, 230, 0.16);
  border-radius: 9px;
  padding: 0.45rem;
  background: rgba(0, 0, 0, 0.24);
  max-height: 64vh;
  overflow: auto;
}
.grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), var(--cell));
  grid-auto-rows: var(--cell);
  gap: 1px;
  width: max-content;
  margin: 0 auto;
  background: rgba(120, 190, 230, 0.08);
}
.cell {
  position: relative;
  padding: 0;
  border: 0;
  border-radius: 1px;
  background: var(--c, rgba(255, 255, 255, 0.03));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.24);
  cursor: crosshair;
  touch-action: none;
}
.cell:hover {
  box-shadow: inset 0 0 0 2px rgba(127, 233, 255, 0.85);
  z-index: 1;
}
.cell.has-drain {
  outline: 1px solid rgba(255, 255, 255, 0.22);
  outline-offset: -2px;
}
.drain-mark {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: calc(var(--cell) * 0.48);
  font-weight: 800;
  color: #08151a;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
}
.water-mark {
  position: absolute;
  inset: 22%;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #d6f8ff, #39c5ff 45%, #146385);
  box-shadow: 0 0 8px rgba(57, 197, 255, 0.7);
  pointer-events: none;
}
.dir-mark {
  position: absolute;
  inset: 18%;
  background: #0b1720;
  clip-path: polygon(50% 0%, 100% 55%, 66% 55%, 66% 100%, 34% 100%, 34% 55%, 0% 55%);
  opacity: 0.75;
  pointer-events: none;
}
.canvas-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.5rem;
  font-size: 0.6rem;
  color: #6d8394;
}
.canvas-foot b {
  color: #9be8ff;
  font-weight: 600;
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.3rem;
}
.section-head h2 {
  margin-top: 0.15rem;
}
.mini {
  padding: 0.22rem 0.45rem;
  font-size: 0.62rem;
}
.empty {
  padding: 0.5rem;
  border: 1px dashed rgba(120, 190, 230, 0.18);
  border-radius: 7px;
  color: #6d8394;
  font-size: 0.65rem;
  line-height: 1.5;
}
.goal-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.3rem;
  flex-wrap: wrap;
}
.goal-row select {
  padding: 0.26rem 0.2rem;
  max-width: 6rem;
}
.goal-row .drain-select {
  max-width: 6.4rem;
}
.goal-row .num {
  width: 3.4rem;
  padding: 0.24rem 0.3rem;
}
.unit {
  font-size: 0.62rem;
  color: #7d94a5;
}
.remove {
  margin-left: auto;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  border: 1px solid rgba(255, 120, 120, 0.25);
  background: rgba(255, 90, 90, 0.08);
  color: #ff9ba3;
  cursor: pointer;
  line-height: 1;
}
.drain-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.22rem 0;
  font-size: 0.68rem;
  color: #b9cbd8;
}
.badge {
  width: 1.25rem;
  height: 1.25rem;
  display: grid;
  place-items: center;
  border-radius: 5px;
  font-weight: 800;
  font-size: 0.62rem;
  color: #08151a;
}
.badge.clean {
  background: #35d0a0;
}
.badge.dirty {
  background: #c06b3f;
}
.muted {
  margin-left: auto;
  color: #6d8394;
  font-size: 0.62rem;
}
.pool {
  display: grid;
  gap: 0.12rem;
  max-height: 290px;
  overflow-y: auto;
  margin-top: 0.35rem;
}
.pool-row {
  display: grid;
  grid-template-columns: 0.65rem 1fr auto;
  gap: 0.35rem;
  align-items: center;
  font-size: 0.66rem;
  color: #a9bfce;
}
.pool-row > i {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 2px;
}
.pool-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stepper {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}
.stepper button {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 4px;
  border: 1px solid rgba(120, 190, 230, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: #c6d8e5;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.stepper b {
  min-width: 1rem;
  text-align: center;
  font-size: 0.64rem;
  color: #d7e7f2;
  font-variant-numeric: tabular-nums;
}
textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 0.45rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.62rem;
  line-height: 1.4;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.4rem;
}
.actions button {
  padding: 0.3rem 0.48rem;
  font-size: 0.64rem;
}
.status {
  margin: 0;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  background: rgba(127, 233, 255, 0.07);
  border: 1px solid rgba(127, 233, 255, 0.2);
  color: #9be8ff;
  font-size: 0.66rem;
  line-height: 1.45;
}
@media (max-width: 1180px) {
  .body {
    grid-template-columns: minmax(230px, 0.8fr) minmax(360px, 1.4fr);
  }
  .right {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }
  .right .panel:last-of-type {
    grid-column: 1 / -1;
  }
  .status {
    grid-column: 1 / -1;
  }
}
@media (max-width: 760px) {
  .head {
    flex-wrap: wrap;
  }
  .head-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .save-state {
    display: none;
  }
  .body {
    grid-template-columns: 1fr;
  }
  .right {
    display: flex;
  }
  .grid-wrap {
    max-height: 60vh;
  }
}
</style>
