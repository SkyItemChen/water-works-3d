/**
 * User settings persisted to localStorage.
 */

import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { SettingsSave } from '../game/core/saveFile';

const KEY = 'waterworks3d.settings.v1';

interface SettingsData {
  muted: boolean;
  showPreview: boolean;
  quality: 'high' | 'medium' | 'low';
  reducedMotion: boolean;
  soundVolume: number;
}

const DEFAULTS: SettingsData = {
  muted: false,
  showPreview: true,
  quality: 'high',
  reducedMotion: false,
  soundVolume: 0.22,
};

function load(): SettingsData {
  const fallback: SettingsData = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SettingsData>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const initial = load();
  const muted = ref(initial.muted);
  const showPreview = ref(initial.showPreview);
  const quality = ref<'high' | 'medium' | 'low'>(initial.quality);
  const reducedMotion = ref(initial.reducedMotion);
  const soundVolume = ref(initial.soundVolume);

  function persist(): void {
    try {
      const data: SettingsData = {
        muted: muted.value,
        showPreview: showPreview.value,
        quality: quality.value,
        reducedMotion: reducedMotion.value,
        soundVolume: soundVolume.value,
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage disabled: ignore */
    }
  }

  watch([muted, showPreview, quality, reducedMotion, soundVolume], persist, { deep: false });

  function toggleMute(): void {
    muted.value = !muted.value;
  }

  function togglePreview(): void {
    showPreview.value = !showPreview.value;
  }

  /** Plain snapshot for export. */
  function exportData(): SettingsSave {
    return {
      muted: muted.value,
      showPreview: showPreview.value,
      quality: quality.value,
      reducedMotion: reducedMotion.value,
      soundVolume: soundVolume.value,
    };
  }

  /** Apply an imported settings block (already validated). */
  function replaceData(next: SettingsSave): void {
    muted.value = next.muted;
    showPreview.value = next.showPreview;
    quality.value = next.quality;
    reducedMotion.value = next.reducedMotion;
    soundVolume.value = next.soundVolume;
  }

  /** Format-save path: drop the stored settings and fall back to defaults. */
  function formatSave(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage disabled: nothing to remove */
    }
    muted.value = DEFAULTS.muted;
    showPreview.value = DEFAULTS.showPreview;
    quality.value = DEFAULTS.quality;
    reducedMotion.value = DEFAULTS.reducedMotion;
    soundVolume.value = DEFAULTS.soundVolume;
  }

  return {
    muted,
    showPreview,
    quality,
    reducedMotion,
    soundVolume,
    toggleMute,
    togglePreview,
    exportData,
    replaceData,
    formatSave,
  };
});
