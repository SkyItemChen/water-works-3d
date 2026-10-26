<script setup lang="ts">
/**
 * SettingsPanel — the modal behind the gear button on the main menu.
 *
 * Also owns the save file: export writes a compact base64 text (positional
 * arrays, see core/saveFile.ts), import validates it in full before touching
 * anything — including the old JSON format — and "格式化存档" wipes the local save
 * after a second, explicitly worded click. All three paths reload the app,
 * because every store already holds a snapshot in memory and a half applied save
 * is exactly how ghost progress appears.
 */
import { ref } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { useProgressStore } from '@/stores/progressStore';
import { decodeSave, encodeSave, SAVE_PREFIX } from '@/game/core/saveFile';
import { APP_VERSION } from '@/game/core/version';

const emit = defineEmits<{ close: [] }>();

const settings = useSettingsStore();
const progress = useProgressStore();

const confirming = ref(false);
const wiped = ref(false);
const exported = ref('');
const importText = ref('');
const status = ref('');
const importArmed = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function close(): void {
  confirming.value = false;
  emit('close');
}

function buildExport(): void {
  exported.value = encodeSave(progress.exportData(), settings.exportData(), APP_VERSION);
  importArmed.value = false;
  status.value = '已生成存档文本（base64），可下载或复制。';
}

function downloadSave(): void {
  if (!exported.value) return;
  const blob = new Blob([exported.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `waterworks3d-save-${new Date().toISOString().slice(0, 10)}.wwsave`;
  a.click();
  URL.revokeObjectURL(url);
  status.value = '已开始下载。';
}

async function copySave(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exported.value);
    status.value = '存档文本已复制。';
  } catch {
    status.value = '复制失败，请手动选择文本框内容。';
  }
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importText.value = await file.text();
  importArmed.value = false;
  status.value = `已读取 ${file.name}，点「导入」应用。`;
}

function applyImport(): void {
  const parsed = decodeSave(importText.value);
  if (!parsed.ok) {
    importArmed.value = false;
    status.value = parsed.error;
    return;
  }
  if (!importArmed.value) {
    importArmed.value = true;
    status.value = `校验通过（来自 v${parsed.version || '?'}）。再点一次确认覆盖当前存档。`;
    return;
  }
  progress.replaceData(parsed.progress);
  if (parsed.settings) settings.replaceData(parsed.settings);
  status.value = '存档已导入，正在重载…';
  setTimeout(() => window.location.reload(), 900);
}

function formatSave(): void {
  if (!confirming.value) {
    confirming.value = true;
    return;
  }
  progress.formatSave();
  settings.formatSave();
  wiped.value = true;
  confirming.value = false;
  setTimeout(() => window.location.reload(), 900);
}

function selectAll(ev: FocusEvent): void {
  (ev.target as HTMLTextAreaElement).select();
}
</script>
<template>
  <Transition name="pop">
    <div class="overlay" @click.self="close">
      <div class="card" role="dialog" aria-label="设置">
        <header>
          <h2>设置</h2>
          <button class="x" aria-label="关闭" @click="close">✕</button>
        </header>

        <div class="rows">
          <label class="row">
            <span>静音</span>
            <input v-model="settings.muted" type="checkbox" />
          </label>
          <label class="row">
            <span>三步水流预览</span>
            <input v-model="settings.showPreview" type="checkbox" />
          </label>
          <label class="row">
            <span>音量</span>
            <input v-model.number="settings.soundVolume" type="range" min="0" max="1" step="0.02" />
          </label>
          <label class="row">
            <span>画质</span>
            <select v-model="settings.quality">
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          <label class="row">
            <span>减少动效</span>
            <input v-model="settings.reducedMotion" type="checkbox" />
          </label>
        </div>

        <section class="storage">
          <h3>存档</h3>
          <p>
            导出会把合同进度、挑战记录、成就与设置压成一段 <code>{{ SAVE_PREFIX }}…</code>
            的 base64 文本（数组存储，无字段名）；导入会覆盖当前存档，旧版 JSON 存档也能直接导入。
          </p>
          <div class="storage-actions">
            <button class="sm" @click="buildExport">导出存档</button>
            <button class="sm" @click="pickFile">导入存档 · 选文件</button>
            <input
              ref="fileInput"
              type="file"
              accept=".wwsave,.txt,.json,application/json,text/plain"
              hidden
              @change="onFile"
            />
          </div>

          <textarea
            v-if="exported"
            :value="exported"
            readonly
            rows="5"
            spellcheck="false"
            @focus="selectAll"
            @click="selectAll"
          ></textarea>
          <div v-if="exported" class="storage-actions">
            <button class="primary sm" @click="downloadSave">下载 .wwsave</button>
            <button class="sm" @click="copySave">复制文本</button>
          </div>

          <textarea
            v-model="importText"
            placeholder="或直接粘贴存档文本（WWSAVE1:… 或旧版 JSON）"
            rows="4"
            spellcheck="false"
          ></textarea>
          <div class="storage-actions">
            <button class="primary sm" :class="{ arming: importArmed }" @click="applyImport">
              {{ importArmed ? '再点一次确认导入' : '导入粘贴的存档' }}
            </button>
            <span class="status">{{ status }}</span>
          </div>
        </section>

        <div class="danger">
          <div class="danger-text">
            <h3>格式化存档</h3>
            <p>清空全部本地进度：合同星级、最高分、挑战记录、成就、教程标记与设置。不可恢复。</p>
          </div>
          <button class="wipe" :class="{ arming: confirming }" @click="formatSave">
            {{ wiped ? '已清空' : confirming ? '再点一次确认清空' : '格式化存档' }}
          </button>
          <button v-if="confirming" class="cancel" @click="confirming = false">取消</button>
        </div>

        <footer>
          <span>所有数据只存在这台设备的 localStorage 里，没有云端备份。</span>
          <button class="done" @click="close">完成</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(4, 8, 12, 0.72);
  backdrop-filter: blur(6px);
  padding: 1rem;
}
.card {
  width: min(460px, 94vw);
  max-height: 90vh;
  overflow-y: auto;
  padding: 1.2rem 1.3rem;
  border-radius: 18px;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: linear-gradient(165deg, #12202c, #0a121a 70%);
  color: #e9f2f8;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.8rem;
}
h2 {
  margin: 0;
  font-size: 1.15rem;
}
.x {
  border: 0;
  background: transparent;
  color: #8fa9bd;
  font-size: 0.95rem;
  cursor: pointer;
}
.x:hover {
  color: #eafaff;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0.1rem;
  font-size: 0.78rem;
  color: #b9cfdd;
  border-bottom: 1px dashed rgba(120, 190, 230, 0.12);
}
.row input[type='checkbox'] {
  width: 1rem;
  height: 1rem;
  accent-color: #7fe9ff;
}
.row input[type='range'] {
  width: 140px;
  accent-color: #7fe9ff;
}
.row select {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(120, 190, 230, 0.24);
  border-radius: 8px;
  color: #cdefff;
  padding: 0.25rem 0.5rem;
  font-size: 0.76rem;
}
.storage {
  margin-top: 1rem;
  padding: 0.8rem;
  border-radius: 12px;
  border: 1px solid rgba(120, 190, 230, 0.18);
  background: rgba(120, 190, 230, 0.04);
}
.storage h3 {
  margin: 0 0 0.2rem;
  font-size: 0.82rem;
  color: #cdefff;
}
.storage p {
  margin: 0 0 0.55rem;
  font-size: 0.68rem;
  line-height: 1.5;
  color: #8fa9bd;
}
.storage textarea {
  width: 100%;
  margin-top: 0.45rem;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(120, 190, 230, 0.22);
  border-radius: 9px;
  color: #cdefff;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.66rem;
  line-height: 1.45;
  padding: 0.45rem;
  resize: vertical;
}
.storage-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}
.storage button.sm {
  padding: 0.35rem 0.7rem;
  border-radius: 8px;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: rgba(255, 255, 255, 0.05);
  color: #cfe4f2;
  font-size: 0.72rem;
  cursor: pointer;
}
.storage button.primary {
  border-color: rgba(127, 233, 255, 0.34);
  background: rgba(127, 233, 255, 0.12);
  color: #d9f7ff;
}
.storage button.arming {
  border-color: rgba(255, 183, 94, 0.55);
  background: rgba(255, 183, 94, 0.18);
  color: #ffe2b8;
}
.storage .status {
  font-size: 0.66rem;
  color: #8fa9bd;
}
.danger {
  margin-top: 1rem;
  padding: 0.8rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 90, 122, 0.28);
  background: rgba(255, 90, 122, 0.06);
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
}
.danger-text {
  flex: 1;
  min-width: 200px;
}
.danger-text h3 {
  margin: 0 0 0.2rem;
  font-size: 0.82rem;
  color: #ff9ba3;
}
.danger-text p {
  margin: 0;
  font-size: 0.68rem;
  line-height: 1.5;
  color: #9aa9b6;
}
.wipe {
  padding: 0.45rem 0.8rem;
  border-radius: 9px;
  border: 1px solid rgba(255, 90, 122, 0.4);
  background: rgba(255, 90, 122, 0.12);
  color: #ffc8cf;
  font-size: 0.75rem;
  cursor: pointer;
  transition: 0.15s ease;
}
.wipe.arming {
  background: rgba(255, 90, 122, 0.28);
  border-color: rgba(255, 90, 122, 0.75);
  color: #fff;
}
.cancel {
  padding: 0.45rem 0.7rem;
  border-radius: 9px;
  border: 1px solid rgba(120, 190, 230, 0.24);
  background: transparent;
  color: #b9cfdd;
  font-size: 0.75rem;
  cursor: pointer;
}
footer {
  margin-top: 0.9rem;
  padding-top: 0.7rem;
  border-top: 1px solid rgba(120, 190, 230, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  font-size: 0.64rem;
  color: #6d8394;
}
.done {
  padding: 0.4rem 0.9rem;
  border-radius: 9px;
  border: 1px solid rgba(127, 233, 255, 0.32);
  background: rgba(127, 233, 255, 0.12);
  color: #d9f7ff;
  font-size: 0.76rem;
  cursor: pointer;
}
.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.16s ease;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
}
</style>
