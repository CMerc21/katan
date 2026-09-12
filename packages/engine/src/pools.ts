/**
 * Pools that scale with the land count (docs/phase8.md §2): terrains keep
 * the standard proportions, tokens keep the pip distribution, harbours
 * scale to about one per 2.2 land hexes with generic:specific ≈ 4:5.
 * Largest-remainder rounding keeps totals exact.
 */

import { RESOURCES, type PortKind, type Terrain } from "./board";

/** Per-19 proportions (§2.1). */
export const TERRAIN_PROPORTIONS: readonly [Terrain, number][] = [
  ["forest", 4],
  ["meadow", 4],
  ["farmland", 4],
  ["claypit", 3],
  ["mountain", 3],
  ["wasteland", 1],
];

/** Per-18 token counts (§2.2). */
export const TOKEN_PROPORTIONS: readonly [number, number][] = [
  [2, 1],
  [3, 2],
  [4, 2],
  [5, 2],
  [6, 2],
  [8, 2],
  [9, 2],
  [10, 2],
  [11, 2],
  [12, 1],
];

/** Largest-remainder apportionment of `total` across weighted items. */
export function apportion<T>(items: readonly [T, number][], total: number): [T, number][] {
  const weight = items.reduce((n, [, w]) => n + w, 0);
  const raw = items.map(([item, w]) => ({ item, exact: (w * total) / weight }));
  const out = raw.map((r) => ({ item: r.item, count: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = total - out.reduce((n, r) => n + r.count, 0);
  const order = out.map((r, i) => i).sort((a, b) => out[b]!.rem - out[a]!.rem || a - b);
  for (const i of order) {
    if (left <= 0) break;
    out[i]!.count += 1;
    left -= 1;
  }
  return out.map((r) => [r.item, r.count]);
}

/** Terrains for `n` land hexes, in a stable order (shuffle before use). Always at least one wasteland so the robber has a home. */
export function terrainPool(n: number): Terrain[] {
  const counts = new Map(apportion(TERRAIN_PROPORTIONS, n));
  if ((counts.get("wasteland") ?? 0) === 0 && n >= 1) {
    const [biggest] = [...counts.entries()].filter(([t]) => t !== "wasteland").sort((a, b) => b[1] - a[1])[0] as [Terrain, number];
    counts.set(biggest, (counts.get(biggest) ?? 1) - 1);
    counts.set("wasteland", 1);
  }
  const out: Terrain[] = [];
  for (const [t] of TERRAIN_PROPORTIONS) for (let i = 0; i < (counts.get(t) ?? 0); i++) out.push(t);
  return out;
}

/** Trim a multiset to `n` items by dropping from the most frequent values first (keeps rare ones like the wasteland). */
export function trimPool<T>(items: readonly T[], n: number): T[] {
  const out = items.slice();
  while (out.length > n) {
    const counts = new Map<T, number>();
    for (const x of out) counts.set(x, (counts.get(x) ?? 0) + 1);
    const [most] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] as [T, number];
    out.splice(out.lastIndexOf(most), 1);
  }
  return out;
}

/** Number tokens for `n` producing hexes. */
export function tokenPool(n: number): number[] {
  const out: number[] = [];
  for (const [t, count] of apportion(TOKEN_PROPORTIONS, n)) for (let i = 0; i < count; i++) out.push(t);
  return out;
}

/** Harbours for `n` land hexes: about n ÷ 2.2, at least 2. */
export function harborCount(n: number): number {
  return Math.max(2, Math.round(n / 2.2));
}

/** Harbour kinds: generic:specific ≈ 4:5, specific ones cycling through the resources. */
export function harborPool(count: number): PortKind[] {
  const generic = Math.round((count * 4) / 9);
  const out: PortKind[] = [];
  for (let i = 0; i < generic; i++) out.push("any");
  for (let i = 0; i < count - generic; i++) out.push(RESOURCES[i % RESOURCES.length] as PortKind);
  return out;
}

/** Pips (ways to roll) for a token. */
export const PIPS: Readonly<Record<number, number>> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
