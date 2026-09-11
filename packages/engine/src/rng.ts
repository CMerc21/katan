/**
 * Seeded pseudo-random number generation (docs/rules.md §12).
 *
 * This module is the only source of randomness in the engine. Every
 * consumer derives a stream from the game seed plus a stream label
 * (e.g. the action index), so replaying a log reproduces every roll.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Returns a new shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

/** FNV-1a 32-bit hash of a string, returned as an unsigned 32-bit integer. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, deterministic 32-bit generator. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a deterministic RNG for `seed` and `stream`. Different streams
 * from the same seed are independent, so callers use one stream per
 * random event, e.g. `createRng(seed, "roll:" + actionIndex)`.
 */
export function createRng(seed: string, stream: string | number = 0): Rng {
  const next = mulberry32(hashString(`${seed}::${stream}`));
  return {
    next,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error(`rng.int: maxExclusive must be a positive integer, got ${maxExclusive}`);
      }
      return Math.floor(next() * maxExclusive);
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
  };
}
