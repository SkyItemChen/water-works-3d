import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useProgressStore } from '../stores/progressStore';
import { recordActionFor } from '../game/core/presentation';
import { decodeSave, encodeSave } from '../game/core/saveFile';

/**
 * Challenge mode must not be a star farm: the same board is played, but the run
 * has to stay out of the contract records (stars, best score, lifetime score).
 */
const memory: Record<string, string> = {};

function installStorage(): void {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => memory[k] ?? null,
    setItem: (k: string, v: string) => {
      memory[k] = String(v);
    },
    removeItem: (k: string) => {
      delete memory[k];
    },
  };
}

describe('challenge isolation', () => {
  beforeEach(() => {
    for (const key of Object.keys(memory)) delete memory[key];
    installStorage();
    setActivePinia(createPinia());
  });

  it('the presentation policy refuses a level bucket for challenge runs', () => {
    expect(recordActionFor('c01', 'contract', true)).toBe('none');
    expect(recordActionFor('c01', 'contract')).toBe('level');
    expect(recordActionFor('c01', 'contract', false)).toBe('level');
    // Challenge flag must not resurrect a bucket for daily/endless either.
    expect(recordActionFor('c01', 'daily', true)).toBe('none');
  });

  it('recording a challenge touches only challenge state, never campaign records', () => {
    const p = useProgressStore();
    p.recordChallenge('c01', 135, true);
    expect(p.levelRecords).toEqual({});
    expect(p.totalStars).toBe(0);
    expect(p.totalScore).toBe(0);
    expect(p.data.totalRuns).toBe(0);
    expect(p.clearedCount).toBe(0);
    expect(p.challengeRecords.c01?.cleared).toBe(true);
  });

  it('an exported save carries the challenge records so an import can restore them', () => {
    const p = useProgressStore();
    p.recordChallenge('c01', 135, true);
    p.concedeChallenge('c02');
    const text = encodeSave(p.exportData(), {
      muted: false,
      showPreview: true,
      quality: 'high',
      reducedMotion: false,
      soundVolume: 0.22,
    }, '0.10.0');

    setActivePinia(createPinia());
    const fresh = useProgressStore();
    const parsed = decodeSave(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    fresh.replaceData(parsed.progress);
    expect(fresh.challengeRecords.c01?.cleared).toBe(true);
    expect(fresh.challengeConcededCount).toBe(1);
    expect(fresh.achievementUnlocks.challenge_first).toBeTruthy();
  });
});
