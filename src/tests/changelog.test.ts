/**
 * Version + changelog invariants.
 *
 * The menu, the pause card and the changelog panel all read `APP_VERSION`, which
 * is inlined from package.json at build time. These tests keep the two from
 * drifting: bump package.json and forget the changelog, and this goes red.
 */
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { CHANGELOG, entryFor, latestEntry, type ChangelogTag } from '../game/core/changelog';
import { APP_VERSION } from '../game/core/version';

const TAGS: ChangelogTag[] = ['新增', '改进', '修复'];

function parts(v: string): number[] {
  return v.split('.').map((n) => Number(n));
}

function compare(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

describe('app version', () => {
  it('comes from package.json, not a hand-typed string', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('is a plain x.y.z semver', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('changelog', () => {
  it('is not empty and lists every version once', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    const seen = new Set(CHANGELOG.map((e) => e.version));
    expect(seen.size).toBe(CHANGELOG.length);
  });

  it('is ordered newest first', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(compare(CHANGELOG[i - 1].version, CHANGELOG[i].version), CHANGELOG[i].version).toBeGreaterThan(0);
      expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date, CHANGELOG[i].version).toBe(true);
    }
  });

  it('documents the version that is actually running', () => {
    expect(latestEntry()?.version).toBe(APP_VERSION);
    expect(entryFor(APP_VERSION)?.title).toBeTruthy();
  });

  it('has a readable date, title and at least one tagged item per entry', () => {
    for (const entry of CHANGELOG) {
      expect(entry.version, entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.date, entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.title.trim().length, entry.version).toBeGreaterThan(0);
      expect(entry.items.length, entry.version).toBeGreaterThan(0);
      for (const item of entry.items) {
        expect(TAGS, entry.version).toContain(item.tag);
        expect(item.text.trim().length, entry.version).toBeGreaterThan(0);
      }
    }
  });

  it('returns undefined for a version that never shipped', () => {
    expect(entryFor('99.99.99')).toBeUndefined();
  });
});
