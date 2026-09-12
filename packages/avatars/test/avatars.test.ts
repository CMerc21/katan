import { describe, expect, it } from "vitest";
import { AVATAR_LAYERS, avatarFromSeed, cycleLayer, isAvatarSpec, normalizeAvatar, randomAvatar, renderAvatar, seededRng } from "../src/index";

describe("docs/phase7.md §4 avatars", () => {
  it("is deterministic: the same seed gives the same spec and the same SVG", () => {
    const a = avatarFromSeed("aldric");
    const b = avatarFromSeed("aldric");
    expect(a).toEqual(b);
    expect(renderAvatar(a, { color: "#b83a2c" })).toBe(renderAvatar(b, { color: "#b83a2c" }));
    expect(avatarFromSeed("beatrix")).not.toEqual(a);
  });

  it("random specs stay within every layer's range and use every option eventually", () => {
    const rng = seededRng("coverage");
    const seen = new Map<string, Set<number>>();
    for (let i = 0; i < 2000; i++) {
      const spec = randomAvatar(rng);
      expect(isAvatarSpec(spec)).toBe(true);
      for (const l of AVATAR_LAYERS) {
        const s = seen.get(l.key) ?? new Set<number>();
        s.add(spec[l.key]);
        seen.set(l.key, s);
      }
    }
    for (const l of AVATAR_LAYERS) expect(seen.get(l.key)!.size).toBe(l.count);
  });

  it("renders every option of every layer to well-formed SVG with the player colour on the garment", () => {
    const base = avatarFromSeed("base");
    for (const l of AVATAR_LAYERS) {
      for (let i = 0; i < l.count; i++) {
        const svg = renderAvatar({ ...base, [l.key]: i }, { color: "#2f5f9d", size: 48 });
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="48" height="48"')).toBe(true);
        expect(svg.endsWith("</svg>")).toBe(true);
        expect(svg).toContain("#2f5f9d");
        expect((svg.match(/</g) ?? []).length).toBeGreaterThan(8);
        // No unbalanced quotes in attributes.
        expect((svg.match(/"/g) ?? []).length % 2).toBe(0);
      }
    }
  });

  it("distinct layer choices change the drawing", () => {
    const base = avatarFromSeed("diff");
    const variants = new Set<string>();
    for (const l of AVATAR_LAYERS) for (let i = 0; i < l.count; i++) variants.add(renderAvatar({ ...base, [l.key]: i }));
    const total = AVATAR_LAYERS.reduce((n, l) => n + l.count, 0);
    // Each layer's options render differently (minus the shared base drawn once per layer).
    expect(variants.size).toBeGreaterThanOrEqual(total - AVATAR_LAYERS.length + 1);
  });

  it("normalizes untrusted specs and cycles layers with wrap-around", () => {
    const fixed = normalizeAvatar({ skin: 99, hair: -1, junk: "x" });
    expect(isAvatarSpec(fixed)).toBe(true);
    expect(fixed.skin).toBe(99 % 6);
    expect(fixed.hair).toBe(9);
    expect(isAvatarSpec({ skin: 1 })).toBe(false);
    const spec = avatarFromSeed("cycle");
    expect(cycleLayer({ ...spec, hair: 9 }, "hair").hair).toBe(0);
    expect(cycleLayer({ ...spec, hair: 0 }, "hair", -1).hair).toBe(9);
  });
});
