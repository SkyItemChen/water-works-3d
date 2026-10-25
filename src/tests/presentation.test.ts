import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CameraController, FRONT_AZIMUTH, FRONT_ELEVATION } from '../game/three/CameraController';
import { WowMoments } from '../game/three/WowMoments';
import { playsWinCinematic, publishesShareCode, recordsProgress, recordActionFor } from '../game/core/presentation';
import { isTutorialLevelId, levelById, tutorialLevels } from '../game/core/level';

/**
 * Presentation-layer tests.
 *
 * The bug these protect against: every tutorial step is a complete level, so each
 * one "wins". Without a presentation guard the win treatment fired on every step
 * — the camera pulled back and the board appeared to shrink, and the next step
 * never restored the framing.
 *
 * Nothing here touches the simulation: these are display-only decisions.
 */

/**
 * Minimal stand-in for the canvas element CameraController listens on.
 *
 * The test environment is plain node: CameraController also registers window
 * listeners, so a no-op window is installed once below.
 */
function fakeEl(w = 1280, h = 800): HTMLElement {
  return {
    style: {} as CSSStyleDeclaration,
    clientWidth: w,
    clientHeight: h,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLElement;
}

if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function makeCamera(w = 1280, h = 800) {
  const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 200);
  const ctl = new CameraController(cam, fakeEl(w, h));
  return { cam, ctl };
}

describe('presentation policy', () => {
  it('a coached intermediate step never plays the win cinematic', () => {
    expect(playsWinCinematic(true, false)).toBe(false);
  });

  it('the last tutorial step and any non-tutorial run do play it', () => {
    expect(playsWinCinematic(true, true)).toBe(true);
    expect(playsWinCinematic(false, false)).toBe(true);
  });

  it('tutorial levels record no progress and publish no share code', () => {
    for (const lvl of tutorialLevels()) {
      expect(isTutorialLevelId(lvl.id)).toBe(true);
      expect(recordsProgress(lvl.id)).toBe(false);
      expect(publishesShareCode(lvl.id)).toBe(false);
      expect(recordActionFor(lvl.id, 'contract')).toBe('none');
    }
  });

  it('contract / daily / endless keep their own buckets', () => {
    expect(recordActionFor('c01', 'contract')).toBe('level');
    expect(recordActionFor('c01', 'daily')).toBe('daily');
    expect(recordActionFor('c01', 'endless')).toBe('endless');
    expect(recordActionFor('c01', 'replay')).toBe('none');
    expect(recordActionFor('draft-1', 'editor')).toBe('none');
  });
});

describe('win cinematic is suppressed for a coached step', () => {
  it('triggerDrain leaves the camera alone when withCamera is false', () => {
    const { ctl } = makeCamera();
    const pullBack = vi.spyOn(ctl, 'pullBack');
    const wm = new WowMoments(
      { winBurst: vi.fn() } as never,
      { emit: vi.fn() } as never,
      ctl,
      { setOverflowAlert: vi.fn() } as never,
    );

    const before = { az: ctl.azimuth, el: ctl.elevation, d: ctl.distance };
    wm.triggerDrain(12, 2, false);

    expect(pullBack).not.toHaveBeenCalled();
    expect(ctl.azimuth).toBe(before.az);
    expect(ctl.elevation).toBe(before.el);
    expect(ctl.distance).toBe(before.d);
    expect(wm.status.last).toBe('drain');
    expect(wm.status.active).toBe(true);
  });

  it('a real finish still pulls the camera back', () => {
    const { ctl } = makeCamera();
    const pullBack = vi.spyOn(ctl, 'pullBack');
    const wm = new WowMoments(
      { winBurst: vi.fn() } as never,
      { emit: vi.fn() } as never,
      ctl,
      { setOverflowAlert: vi.fn() } as never,
    );

    wm.triggerDrain(12, 2, true);
    expect(pullBack).toHaveBeenCalledTimes(1);
  });
});

describe('refitForNewScene restores the default front framing', () => {
  it('clears a pull-back and returns to the fitted defaults', () => {
    const { ctl } = makeCamera();

    // Simulate the state left behind by a finished level.
    ctl.pullBack(3);
    for (let i = 0; i < 240; i++) ctl.update(1 / 60);
    const pulled = { az: ctl.azimuth, el: ctl.elevation, d: ctl.distance };
    expect(pulled.d).toBeGreaterThan(30); // genuinely pulled back

    ctl.refitForNewScene();

    expect(ctl.azimuth).toBeCloseTo(FRONT_AZIMUTH, 6);
    expect(ctl.elevation).toBeCloseTo(FRONT_ELEVATION, 6);
    // Default distance is the fitted distance for this viewport, not the old one.
    const expected = new CameraController(new THREE.PerspectiveCamera(40, 1.6, 0.1, 200), fakeEl()).distance;
    expect(ctl.distance).toBeCloseTo(expected, 6);
    expect(ctl.distance).toBeLessThan(pulled.d);
  });

  it('forgets a manual zoom, so the next step opens at the default size', () => {
    const { ctl } = makeCamera();
    const defaultDistance = ctl.distance;

    ctl.zoomBy(0.5); // player zooms in hard
    ctl.update(2);
    expect(ctl.distance).toBeLessThan(defaultDistance);

    ctl.refitForNewScene();
    expect(ctl.distance).toBeCloseTo(defaultDistance, 6);
  });

  it('is idempotent: repeated step changes always yield the same framing', () => {
    const { ctl } = makeCamera();
    ctl.refitForNewScene();
    const first = { az: ctl.azimuth, el: ctl.elevation, d: ctl.distance };

    for (let i = 0; i < 5; i++) {
      ctl.pullBack(3);
      ctl.update(3);
      ctl.rotateBy(0.3);
      ctl.zoomBy(1.4);
      ctl.refitForNewScene();
    }

    expect(ctl.azimuth).toBeCloseTo(first.az, 6);
    expect(ctl.elevation).toBeCloseTo(first.el, 6);
    expect(ctl.distance).toBeCloseTo(first.d, 6);
  });
});


describe('retrying a board restores the view the player left', () => {
  /** Win cinematic: pull back, then let it finish so the pull-back is settled. */
  function finishWin(ctl: ReturnType<typeof makeCamera>['ctl']): void {
    ctl.pullBack(3);
    for (let i = 0; i < 240; i++) ctl.update(1 / 60);
  }

  it('capturePose + restorePose round-trips orbit and manual zoom', () => {
    const { ctl } = makeCamera();
    ctl.rotateBy(-0.25);
    ctl.zoomBy(0.6); // hard zoom-in, marks manualZoom
    ctl.update(2);
    const before = ctl.capturePose();

    finishWin(ctl);
    expect(ctl.distance).toBeGreaterThan(before.distance); // pulled back

    ctl.restorePose(before);
    expect(ctl.azimuth).toBeCloseTo(before.azimuth, 6);
    expect(ctl.elevation).toBeCloseTo(before.elevation, 6);
    expect(ctl.distance).toBeCloseTo(before.distance, 6);
    expect(ctl.capturePose().manualZoom).toBe(true);
  });

  it('restores synchronously: the next update does not drift toward the old pull-back', () => {
    const { ctl } = makeCamera();
    ctl.rotateBy(0.2);
    const before = ctl.capturePose();
    finishWin(ctl);

    ctl.restorePose(before);
    for (let i = 0; i < 120; i++) ctl.update(1 / 60);

    expect(ctl.azimuth).toBeCloseTo(before.azimuth, 3);
    expect(ctl.elevation).toBeCloseTo(before.elevation, 3);
    expect(ctl.distance).toBeCloseTo(before.distance, 1);
  });

  it('a player who never zoomed falls back to the fitted distance, not the pulled-back one', () => {
    const { ctl } = makeCamera();
    const fitted = ctl.distance;
    const before = ctl.capturePose();
    finishWin(ctl);

    ctl.restorePose(before);
    expect(ctl.distance).toBeCloseTo(fitted, 6);
    expect(ctl.capturePose().manualZoom).toBe(false);
  });

  it('keepView leaves the current view untouched but cancels a running cinematic', () => {
    const { ctl } = makeCamera();
    ctl.rotateBy(0.3);
    ctl.zoomBy(0.8);
    ctl.update(2);
    const held = { az: ctl.azimuth, el: ctl.elevation, d: ctl.distance };

    ctl.pullBack(3);
    ctl.update(0.2); // mid-cinematic, slightly moved
    const mid = ctl.capturePose();
    ctl.keepView();
    for (let i = 0; i < 60; i++) ctl.update(1 / 60);

    // Nothing drifts back to the pulled-back pose after the cancel.
    expect(ctl.azimuth).toBeCloseTo(mid.azimuth, 6);
    expect(ctl.distance).toBeCloseTo(mid.distance, 6);
    // ...nor does it jump to the fitted default.
    expect(ctl.distance).not.toBeCloseTo(held.d, 6);
  });
});

describe('tutorial levels never pollute progress records', () => {
  it('no tutorial level id is a contract level', () => {
    for (const lvl of tutorialLevels()) {
      const found = levelById(lvl.id);
      expect(found?.id).toBe(lvl.id);
      expect(recordsProgress(lvl.id)).toBe(false);
    }
  });

  it('a coached win produces no share code', () => {
    for (const lvl of tutorialLevels()) {
      expect(publishesShareCode(lvl.id)).toBe(false);
    }
  });
});
