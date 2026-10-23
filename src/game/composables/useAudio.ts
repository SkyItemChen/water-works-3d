/**
 * WebAudio synthesised sound effects. No external assets, no network.
 * The AudioContext is created lazily on the first user gesture so browsers
 * do not block playback. Every call is a no-op when muted.
 */

import { ref, type Ref } from 'vue';

type SfxName =
  | 'move'
  | 'rotate'
  | 'drop'
  | 'lock'
  | 'drainClean'
  | 'drainDirty'
  | 'mix'
  | 'burst'
  | 'win'
  | 'lose'
  | 'ui'
  | 'hold';

export interface AudioApi {
  muted: Ref<boolean>;
  ready: Ref<boolean>;
  init: () => void;
  play: (name: SfxName) => void;
  toggleMute: () => void;
  setMuted: (v: boolean) => void;
}

export function useAudio(): AudioApi {
  const muted = ref(false);
  const ready = ref(false);
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let lastPlay: Record<string, number> = {};

  function init(): void {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
      ready.value = true;
    } catch {
      ctx = null;
    }
  }

  function tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'sine',
    gain = 0.5,
    slideTo?: number,
  ): void {
    if (!ctx || !master || muted.value) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function noise(dur: number, gain = 0.25, highpass = 700): void {
    if (!ctx || !master || muted.value) return;
    const now = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 22222;
    for (let i = 0; i < frames; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = ((seed / 4294967296) * 2 - 1) * (1 - i / frames);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = highpass;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(now);
  }

  function play(name: SfxName): void {
    if (muted.value) return;
    init();
    if (!ctx) return;
    const now = performance.now();
    const throttled = ['move', 'rotate', 'drainClean', 'drainDirty', 'mix'];
    if (throttled.includes(name) && now - (lastPlay[name] ?? 0) < 55) return;
    lastPlay[name] = now;

    switch (name) {
      case 'move':
        tone(330, 0.045, 'triangle', 0.12);
        break;
      case 'rotate':
        tone(440, 0.06, 'square', 0.08, 620);
        break;
      case 'drop':
        tone(180, 0.12, 'sine', 0.3, 90);
        break;
      case 'hold':
        tone(520, 0.09, 'triangle', 0.14, 680);
        break;
      case 'lock':
        tone(140, 0.14, 'triangle', 0.28, 100);
        noise(0.08, 0.1, 900);
        break;
      case 'drainClean':
        tone(660, 0.08, 'sine', 0.16, 880);
        break;
      case 'drainDirty':
        tone(220, 0.1, 'sawtooth', 0.12, 180);
        break;
      case 'mix':
        tone(392, 0.18, 'sine', 0.14, 523);
        tone(523, 0.22, 'sine', 0.1, 659);
        break;
      case 'burst':
        noise(0.35, 0.4, 300);
        tone(90, 0.3, 'sawtooth', 0.3, 45);
        break;
      case 'win':
        tone(523, 0.18, 'triangle', 0.25);
        setTimeout(() => tone(659, 0.18, 'triangle', 0.25), 140);
        setTimeout(() => tone(784, 0.32, 'triangle', 0.3), 280);
        setTimeout(() => tone(1046, 0.5, 'sine', 0.24), 440);
        break;
      case 'lose':
        tone(300, 0.3, 'sawtooth', 0.2, 150);
        setTimeout(() => tone(180, 0.45, 'sine', 0.18, 80), 180);
        break;
      case 'ui':
        tone(720, 0.035, 'sine', 0.08);
        break;
    }
  }

  function setMuted(v: boolean): void {
    muted.value = v;
    if (master) master.gain.value = v ? 0 : 0.22;
  }

  function toggleMute(): void {
    setMuted(!muted.value);
  }

  return { muted, ready, init, play, toggleMute, setMuted };
}
