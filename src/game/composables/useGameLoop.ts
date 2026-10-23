/**
 * Fixed-timestep game loop driven by requestAnimationFrame.
 *
 * The simulation always advances in whole 1/60s ticks; rendering happens once
 * per animation frame. A capped accumulator prevents spiral-of-death after a
 * tab has been backgrounded.
 */

import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { FIXED_DT } from '../core/constants';

export interface LoopOptions {
  onTick: (dt: number) => void;
  onRender: (dt: number, alpha: number) => void;
  maxCatchUp?: number;
}

export function useGameLoop(opts: LoopOptions) {
  const running = shallowRef(false);
  let raf = 0;
  let last = 0;
  let acc = 0;
  const maxCatchUp = opts.maxCatchUp ?? 5;

  function frame(now: number): void {
    if (!running.value) return;
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    const rawDt = (now - last) / 1000;
    last = now;
    // Clamp huge frame gaps (tab switch, breakpoint) to avoid hitch.
    const dt = Math.min(rawDt, 0.25);
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < maxCatchUp) {
      opts.onTick(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === maxCatchUp) acc = 0;
    const alpha = acc / FIXED_DT;
    opts.onRender(dt, alpha);
  }

  function start(): void {
    if (running.value) return;
    running.value = true;
    last = 0;
    acc = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop(): void {
    running.value = false;
    cancelAnimationFrame(raf);
  }

  onMounted(() => {
    /* caller decides when to start */
  });

  onBeforeUnmount(() => {
    stop();
  });

  return { running, start, stop };
}
