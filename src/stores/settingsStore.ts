/**
 * User settings persisted to localStorage.
 */

import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const KEY = 'waterworks3d.settings.v1';

interface SettingsData {
  muted: boolean;
  showPreview: boolean;
  quality: 'high' | 'medium' | 'low';
  reducedMotion: boolean;
  soundVolume: number;
}

function load(): SettingsData {
  const fallback: SettingsData = {
    muted: false,
    showPreview: true,
    quality: 'high',
    reducedMotion: false,
    soundVolume: 0.22,
  };
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

  return { muted, showPreview, quality, reducedMotion, soundVolume, toggleMute, togglePreview };
});
