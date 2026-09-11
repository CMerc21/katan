import { describe, expect, it } from "vitest";
import { createRng, hashString } from "../src/rng";

describe("§12 seeded rng", () => {
  it("§12 same seed and stream produce the same sequence", () => {
    const a = createRng("seed-a", "roll:1");
    const b = createRng("seed-a", "roll:1");
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    expect(sa).toEqual(sb);
  });

  it("§12 different streams differ", () => {
    const a = createRng("seed-a", "roll:1");
    const b = createRng("seed-a", "roll:2");
    const sa = Array.from({ length: 5 }, () => a.next());
    const sb = Array.from({ length: 5 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it("§12 int stays in range and covers all values", () => {
    const rng = createRng("cover");
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
      seen.add(n);
    }
    expect(seen.size).toBe(6);
    expect(() => rng.int(0)).toThrow();
  });

  it("§12 shuffle is a permutation and does not mutate input", () => {
    const rng = createRng("shuffle");
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.slice().sort((x, y) => x - y)).toEqual(input);
    expect(out).not.toEqual(input);
  });

  it("hashString is stable", () => {
    expect(hashString("")).toBe(0x811c9dc5);
    expect(hashString("a")).toBe(hashString("a"));
    expect(hashString("a")).not.toBe(hashString("b"));
  });
});
