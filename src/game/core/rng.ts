/**
 * Deterministic PRNG utilities.
 * xmur3 string hash + mulberry32 stream. Never uses Math.random.
 */

export type Rng = () => number;

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h = (h ^= h >>> 16) >>> 0;
    return h;
  };
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a stable rng from a numeric seed and an optional salt string. */
export function hashSeed(seed: number, salt = ''): number {
  return xmur3(`${seed >>> 0}|${salt}`)();
}

export function makeRng(seed: number, salt = ''): Rng {
  return mulberry32(hashSeed(seed, salt));
}

export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Deterministic 32-bit FNV-1a hash of a typed array / string mix. */
export function fnv1a(input: string | Uint8Array): number {
  let h = 0x811c9dc5;
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash a Float64Array by quantising values to 1/4096 to absorb float noise. */
export function hashFloats(values: Float64Array, acc = 0x811c9dc5): number {
  let h = acc >>> 0;
  for (let i = 0; i < values.length; i++) {
    const q = Math.round(values[i] * 4096) | 0;
    h ^= q & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (q >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
