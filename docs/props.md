# Katan — Tile and Prop Brief

Companion to `docs/phase7-5.md` §1; implemented in `apps/web/src/board3d` (`slab.ts`, `props.ts`, `Props.tsx`, `Pieces.tsx`, `Crown3d.tsx`, `Effects3d.tsx`, `Harbor.tsx`, `palette.ts`). The reference images in `docs/art/reference/` are the target; this document translates them into geometry. Hex radius R = 1 world unit. All props are built from primitives with `flatShading: true`; no textures except the table.

## 1. Slab (all tiles)

- Extruded hexagon, crisp edges (no bevel), corner radius 0.03 R.
- **Land:** total height 0.22 R in two layers: top layer 0.12 R in the terrain color, lower layer 0.10 R in earth brown `#8A5A3C` (mountains may use a mid band `#C9976A` between grey and brown).
- **Sea:** total height 0.15 R, single color `#3FA8C4` sides, top face a lighter faceted surface (§3).
- Per-tile jitter: rotation ±0.4°, height ±1.5%, applied by seed.
- **Center recess (land only):** circular depression radius 0.32 R, depth 0.03 R, floor color earth tan `#B8865A`. The number token sits in it; the robber stands in it on the desert.
- Top face has a gentle low-poly relief: displace vertices ±0.02 R by seeded noise, flat-shaded, so the surface shows facets like the references.

## 2. Terrain colors

| Terrain | Top | Notes |
|---|---|---|
| Forest | `#6FA35C` | |
| Pasture | `#7DBF4E` | slightly brighter than forest |
| Fields | `#E8B84A` | |
| Hills | `#D97A4D` base with a lighter `#E8C48A` apron around the recess | |
| Mountains | `#8E97A3` | mid band `#C9976A` |
| Desert | `#E6C889` | |
| Sea | `#3FA8C4` sides, `#5FC8DC` top | |

## 3. Per-terrain prop layouts

Props avoid the center recess and a 0.06 R margin at the slab edge. Layout positions are seeded; the counts below are the defaults at High quality (Medium ×0.7, Low ×0.4, minimum 1 hero prop).

**Forest** — 6–8 pines (3 stacked 6-segment cones, radii 0.14/0.11/0.08 R, tier overlap 25%, alternating `#8DBF5A` / `#4F7A48`, trunk `#7A5233`), 2–3 oaks (icosphere canopy detail 1, radius 0.16 R, `#7DB45A`, plus 3 smaller spheres, tapered trunk), 1 log cabin (box `#8B4A2B` with 4 horizontal groove stripes, gabled prism roof `#6FA35C`, chimney box), 2 log piles (3 cylinders), 1–2 stumps (cylinder, lighter top disc), 1 fallen log. Hero prop: cabin.

**Pasture** — 5–6 sheep (icosphere body detail 1 radius 0.09 R white `#F4EFE6`, head small dark sphere `#2B2118`, 4 stub legs), 1 stone shepherd's hut (box with stone-ish darker face color `#9A9A94`, thatch roof as squashed faceted dome `#D9B25C`, door quad), 2 fence runs (thin posts + 2 rails, 4–6 segments, `#A67C4F`), a coiled rope disc and a crook as optional details. Hero: hut. Sheep bob 0.01 R at random phase; one rotates 15° every few seconds.

**Fields** — 4 wheat rows arranged around the recess, each row a thin box base with 6–8 heads (elongated spheres `#E3B04B` on short stems `#A67C4F`), 1 windmill (cylinder stone base `#9A9A94`, tapered wood body `#A67C4F`, hub with 4 lattice blades made from thin boxes, rotates 0.15 rad/s). Hero: windmill. Rows sway ±2°.

**Hills** — 3 terraced mounds (stacked low-poly discs, 2–3 tiers, `#D97A4D` → `#E8955E`), 1 kiln (low-poly dome `#B84E3A` with a few lighter brick quads, arched door quad, tall chimney box), 1 brick stack (box with brick-pattern face `#C8553D`/`#A9432E`), 1 cart (box body, 2 disc wheels, 2 shaft cylinders). Hero: kiln. Chimney emits small sphere puffs every 4 s.

**Mountains** — 3 peaks (irregular cones, 6 radial segments, vertices jittered ±10%, `#8E97A3`, white snow cone `#F4EFE6` covering the top 30%), 1 rounded rock mound with a mine entrance (box frame `#C9976A` and a dark quad), 4–5 ore nuggets (octahedra 0.05–0.08 R, two gold `#E8B84A` emissive 0.2, rest silver `#C9CFD6`). Hero: mine.

**Desert** — 1 saguaro cactus (cylinder trunk, 2 bent arm cylinders, `#6FA35C`), 4–6 rocks (small dodecahedra `#B8A58A`), 1 bone pile (3 short white cylinders with knobs), 2 coins optional. Sparse. Hero: cactus. No idle motion.

**Sea** — top face displaced ±0.03 R, 2 white crests (elongated squashed icosphere `#F4EFE6`, 0.15 R long) placed off-center, gentle vertex ripple (0.01 R amplitude, 0.6 Hz). No recess. Optional gull sprite at Medium+.

**Gold (Phase 9)** — mountains layout with 2 peaks, a sluice (angled box trough on legs) and 6 gold nuggets. **Lake (Phase 10)** — desert-height slab with a recessed water disc (radius 0.6 R) and reeds (thin cylinders `#6FA35C`).

## 4. Pieces (from the pieces reference)

- **Base ring:** all settlements, cities, and knights sit on a cylinder radius 0.11 R, height 0.02 R, in the player color; this is the recolorable part.
- **Settlement:** box body 0.14 × 0.10 × 0.10 R `#F4EFE6` with dark quad door and 2 window quads; thatch roof as a squashed faceted dome `#D9B25C` overhanging 15%.
- **City:** cylinder tower radius 0.08 R height 0.16 R `#7A8798`, crenellations as 8 small boxes, a second half-height tower offset, box gatehouse with arch quad, flag pole with triangular flag in player color.
- **Road:** flat box length = hex edge (1 R), width 0.10 R, thickness 0.04 R, top `#C9976A`, sides in player color; 4 tiny nail dots optional.
- **Robber:** cone body `#2B2118` height 0.22 R, second cone hood, off-white face plate quad with two dark eye dots, ochre sphere sack `#E8B84A` at the side, round base disc dark grey. In play this procedural figure is the fallback: `RobberFigure` first loads `public/models/robber.glb` through `loadPiece` (flat-shaded near-black `#1a1a1a`, roughness 0.8, scaled to the same 0.32 R height with its foot at the origin) and shows the cones only until the GLB arrives or if it fails.
- **GLB pieces (settlement, city, road, and the Phase 9/11 pieces below):** the same rule. `settlement.glb` (cottage) and `city.glb` (keep with a flag) are split by raw-model Y into base / middle / top zones (`PIECES` in `loadPiece.ts`): base and top in the player colour, the middle in plaster `#F4EFE6` (settlement) or stone `#7A8798` (city); scaled to the procedural heights 0.18 R and 0.34 R. `road.glb` (a bridge, 1.0 long on its Z, 0.46 wide, 0.10 thick) is wholly in the player colour, scaled per axis to explicit world dimensions of 0.80 × 0.18 × 0.08 of the hex edge (length on Z, width on X, thickness on Y; the edge is 1 R, the distance between two adjacent vertices), lifted by half its thickness and turned to lie along the edge, so it stops short of the settlements at either vertex. `loadPiece` logs each piece's fitted world size once per session. Each figure keeps its procedural version as the fallback.
- **GLB pieces, world units (hex edge = 1, x width × y height × z length; `PIECES` in `loadPiece.ts`, every model lifted by its own min Y):** `metropolis.glb` 0.34 × 0.44 × 0.34 replaces the city at a metropolis vertex (zones −0.42 / 0.38: base and crown in the player colour, body grey `#8a8f99`); `city_walled.glb` 0.46 × 0.34 × 0.46 replaces the city when the vertex has a wall (zones −0.32 / 0.20: base disc and flag player-coloured, ring and tower grey), and a walled metropolis is the metropolis over a flat player-coloured ring (outer 0.46, inner 0.36, 0.05 tall); `ship.glb` 0.22 × 0.26 × 0.70 on sea edges (length on its local X, turned to Z, then the road orientation; only the sail above raw Y 0.20 is player-coloured, the rest wood `#8b6a45`, hull bottom at raw Y −0.455 on the water); `barbarian_ship.glb` 0.30 × 0.28 × 0.65 on the table track (sail above 0.24 dark red `#7a2a2a`, hull near-black `#1a1a1a`); `pirate.glb` 0.36 × 0.32 × 0.32 at the sea hex (sail above 0.18 dark red, rest near-black, laid along the hex's flat sides); `merchant.glb` 0.30 × 0.30 × 0.30 at the hex like the robber, one warm neutral `#c9b58a`; `knight_1/2/3.glb` 0.18 × 0.26 × 0.18, 0.20 × 0.28 × 0.20, 0.23 × 0.30 × 0.23 (zones −0.42 / 0.10, −0.33 / 0.22, −0.38 / 0.19: base and top player-coloured, body grey; the level is which model loads, there are no rank pips; inactive knights have every zone colour × 0.55 and roughness 1); `port_sign.glb` 0.26 × 0.30 × 0.24 at the pier's seaward end facing the land hex, wood (the ratio label stays on the hanging sign). The settlement, city and robber heights are the procedural ones × 1.5 (0.27, 0.51, 0.48).
- **Ship (Phase 9):** small rounded hull `#8B4A2B` length 0.6 R with a raised stern, mast cylinder, one gently curved sail plane in player color; sits on a base ring like other pieces.
- **Knight (Phase 11, procedural fallback):** three levels, all on a base ring in player color, all in player color (inactive: desaturated grey `#9A9A94`, base ring dimmed). No rank pips: the level is the figure (and, in play, which GLB loads).
  - Level 1 (basic): single squat sphere body radius 0.08 R, small sphere head, plain round helm cap, a small round shield held low. Total height ≈ 0.20 R.
  - Level 2 (strong): two stacked spheres (body 0.09 R, head 0.06 R), pointed helm cone, round shield at the side. Height ≈ 0.26 R.
  - Level 3 (mighty): body scaled 1.3×, great helm as a cylinder with a visor slit quad, a plume (thin bent cylinder) on top, kite shield (tapered quad) held forward, a sword (thin box blade, small box guard) raised in the other hand, short cape as a curved plane behind. Height ≈ 0.34 R.
- All pieces are 1.5× their "true" scale relative to props so they read from the default camera.

## 5. Token, harbor, dice

- **Token:** cylinder radius 0.20 R height 0.04 R, clay `#C9976A` (red `#C8553D` for 6/8), with a raised rim 0.01 R high and a recessed face; numeral as a canvas-baked sprite on the recessed face, pips as small dark dots below the numeral.
- **Harbor:** two post cylinders and a plank box extending 0.35 R from the coast edge over the water; a tall post with a gallows-style crossbar at the landward end, and a small sign quad hanging from the crossbar showing the resource sprite or "3:1".
- **Dice:** rounded boxes 0.18 R bone `#F4EFE6` with indented pip spheres, in a soft leather tray (beveled box `#6B3E2E` with slightly flared sides, no hard corners) at the board's near edge.
- **Metropolis (Phase 11):** the city keep with a central spire (tall tapered box tower, pointed roof) rising to ~0.40 R, topped by a small gold crown (short cylinder with 4–5 cone points, `#E8B84A`); optional side turrets with mini spires.
- **City walls (Phase 11):** a low ring wall around the city, radius 0.13 R, height 0.05 R, crenellated top (16 small boxes), `#7A8798`; each wall level adds nothing visual beyond the first ring — show a small stacked-stone marker per extra wall instead of more rings.
- **Merchant (Phase 11):** rotund figure — sphere body in green `#4E8A4A`, sphere head, round flat hat, small ledger box in one hand — beside a two-wheel cart carrying two crates; on a green base ring. Not player-colored.
- **Pirate ship (Phase 9):** dark hull `#3A3532`, single black square sail, small black pennant at the masthead, no base ring.
- **Barbarian longship (Phase 11 fleet):** long low dark hull 0.9 R, dragon-head prow (stacked cones), a row of 6 round shields along each side, one square tattered grey sail (`#8A857D`, notched edges), no base ring. Moves along the fleet track at the board's far edge.
- **Event die (Phase 11):** rounded box like the number dice with solid-colored faces instead of pips: 3 faces black (fleet, with a small ship glyph sprite), 1 blue (politics), 1 green (trade), 1 yellow (science); the red number die uses white pips.
- **Flag:** short pole cylinder with a small triangular flag plane in player color; used on cities and as the island-bonus pennant in Phase 9.

## 6. Lighting and post

- Key: directional, warm `#FFE7C2`, intensity 1.6, from azimuth −40°, elevation 42°, casting soft shadows (PCF, map 2048 on High).
- Fill: hemisphere sky `#CFE3F0` ground `#6B4A33`, intensity 0.5.
- Table: plane with a subtle procedural wood-grain shader or a single tiling texture, walnut `#5B3A24`, receives shadows.
- Post (High only): vignette 0.3, tilt-shift blur on the top and bottom 20% of the frame.

## 7. Implementation notes and deviations

- **Slab geometry** is one face-coloured, non-indexed geometry per tile (`slab.ts`): a ring-walk triangulation from the centre recess out to the rounded outline, top-face relief from seeded value noise, and the side walls split into the terrain, band and earth layers. Land tiles are built per hex id; the sea uses three seeded facet variants turned by multiples of 60° so neighbours differ; the frame (the table edge on boards without a sea module) is a flat walnut slab of sea height.
- **Props stand on the relief.** `reliefField` gives the same noise the slab was built from, so every prop samples its footing instead of floating over a facet. Hero props are placed first so they always find room; the other counts drop with the quality density (Medium ×0.7, Low ×0.4) and a recipe can fail to find a clear spot on a crowded tile, so a forest may show one log pile rather than two.
- **Roads are 0.8 R long**, not the full hex edge: the ends would otherwise run under the base rings of the settlements at both vertices. The cross-section is at the pieces' 1.5× scale.
- **Colours on the DOM stay as they were.** `src/game/theme.ts` (cards, thumbnails, the improvement tracks) is untouched; the diorama's palette lives in `board3d/palette.ts`. The event die follows §5 (blue politics, green trade, yellow science), so its faces do not share the tracks' cloth/coin/paper colours used on the progress sheet; the metropolis spire's roof takes the track colour under the gold crown so the two still read together.
- **Walls** have no levels in the engine (one wall per city), so the stacked-stone marker of §5 is not drawn.
- **The island-bonus pennant** of §5 is not on the board yet: the client view exposes which islands earned a chip but not the hexes of each island, so the flag is used on cities only.
- **The robber** stands in the recess only on the desert (no token there); elsewhere it stands beside the token as before.
- **Post-processing** uses the tilt-shift's focus line across mid-frame with a taper of 0.35 of the diagonal, which blurs roughly the top and bottom fifth; vignette 0.3.
- Lighting azimuth is measured like the camera's (−35° is the default view), so the key comes from just left of the default camera and shadows fall away from the viewer.
