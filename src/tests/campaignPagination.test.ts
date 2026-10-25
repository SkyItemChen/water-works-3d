import { describe, expect, it } from 'vitest';
import {
  LEVELS_PER_PAGE,
  campaignPageCount,
  campaignPageForIndex,
  campaignPageSlice,
  clampCampaignPage,
  firstPlayableIndex,
  isLevelUnlocked,
} from '../game/core/campaign';

const levels = Array.from({ length: 60 }, (_, i) => ({ index: i + 1 }));

describe('campaign pagination and unlocking', () => {
  it('pages 60 levels ten at a time', () => {
    expect(LEVELS_PER_PAGE).toBe(10);
    expect(campaignPageCount(60)).toBe(6);
    expect(campaignPageSlice(levels, 1).map((l) => l.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(campaignPageSlice(levels, 6).map((l) => l.index)).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
    expect(campaignPageSlice(levels, 7).at(-1)?.index).toBe(60);
  });

  it('maps level indices to pages and clamps bad page numbers', () => {
    expect(campaignPageForIndex(1)).toBe(1);
    expect(campaignPageForIndex(10)).toBe(1);
    expect(campaignPageForIndex(11)).toBe(2);
    expect(campaignPageForIndex(60)).toBe(6);
    expect(clampCampaignPage(0, 60)).toBe(1);
    expect(clampCampaignPage(99, 60)).toBe(6);
  });

  it('only the first level is open on a fresh save', () => {
    const none = () => false;
    expect(isLevelUnlocked(1, none)).toBe(true);
    expect(isLevelUnlocked(2, none)).toBe(false);
    expect(isLevelUnlocked(60, none)).toBe(false);
  });

  it('clearing the previous level unlocks the next one', () => {
    const cleared = new Set([1, 2, 3]);
    const isCleared = (i: number) => cleared.has(i);
    expect(isLevelUnlocked(4, isCleared)).toBe(true);
    expect(isLevelUnlocked(5, isCleared)).toBe(false);
  });

  it('finds the first unfinished level for the continue button', () => {
    const cleared = new Set([1, 2, 3]);
    expect(firstPlayableIndex(levels, (i) => cleared.has(i))).toBe(4);
  });
});
