# Phase 7.5 — 3D Diorama Board

Companion to `docs/phase7.md` and `docs/art-direction.md`. The board in play is now a Three.js diorama rendered with react-three-fiber (`apps/web/src/board3d`). Engine, events, drivers, dialogs and panels are untouched; the animation queue, skip and speed settings are unchanged. The old SVG board lives in `apps/web/src/board2d` and draws thumbnails only. §10 lists decisions and deviations.

## 1. Look

The tile and prop brief in `docs/props.md` is the target for everything below; it translates the reference renders in `docs/art/reference/` into geometry.

- **Tiles:** crisp-edged hex slabs with a 0.03 R corner radius (`slab.ts`), land in two layers (0.12 R terrain colour over 0.10 R earth brown, a tan band on mountains), a circular centre recess for the token, and a seeded low-poly relief on the top face. Sea slabs are 0.15 R, one colour with a lighter faceted top that ripples; the frame is a flat walnut slab. Seeded rotation (±0.4°) and height jitter (±1.5%) per tile (`tileJitter`).
- **Props:** `propsForHex(hex, terrain, density)` lays out a seeded cluster per tile from the brief's recipes (pines, oaks, a log cabin, log piles, stumps; sheep, a stone hut, fences; wheat rows around the recess and a windmill; terraced mounds, a kiln, a brick stack, a cart; snow peaks, a mine, nuggets; a saguaro, rocks, bones; crests and a gull on the sea; reeds on lakes; a sluice on gold). Each terrain's hero prop is always present; props keep off the recess and a 0.06 R edge margin and stand on the slab's relief. Every static kind is one merged, face-coloured geometry drawn as an `InstancedMesh`; windmills turn, kilns puff smoke, sheep bob, wheat sways and the gull circles as animated components. A standard board is under 40 draw calls for props.
- **Materials:** flat-shaded `MeshStandardMaterial`; the only textures are the table grain, token faces, harbour signs and the event die's fleet glyph, all baked on a canvas at runtime. Dice pips are geometry.
- **Light:** a warm directional key from azimuth −40°, elevation 42° with PCF soft shadows (2048 map on High, 1024 on Medium) through a camera fitted to the board's extents, dim hemisphere and directional fills, a rim light on High, a walnut table. No post-processing. Pieces and props carry an inverted-hull outline; see `docs/props.md` §6.
- **Pieces:** thatched cottages, stone keeps with two towers, a gatehouse and a flag, ships with a curved sail, all on a base ring in the player's colour; flat roads with a clay top and player-coloured sides; the hooded robber with a face plate and a sack; knights in three levels; the metropolis spire; the barbarian longship sailing the on-table track (`src/board/props/BarbarianTrack`). All at 1.5× true scale.
- **Tokens:** clay discs (red for 6 and 8) with a raised rim and a recessed face carrying the numeral and pips, sitting in the slab's recess. **Harbours:** two posts and a plank pier over the water with a gallows post and a hanging sign.

## 2. Scene structure

`Board3D` → `<Canvas>` → `CameraRig`, `Lights`, `Table`, `Tiles`, `Props`, `Harbor`×H, pieces (`RoadFigure`, `SettlementFigure`, `CityFigure`), `AnimatedRobber`, `InteractionLayer`, `DiceTray3D`, `Projector`, optional `EffectComposer`. World units: hex radius = 1, the engine's unit geometry with y → z (`layout3d.ts`), so IDs map to the same points as the 2D layout (unit tested).

## 3. Camera

`OrbitControls` around the board centroid with damping; default azimuth −35°, elevation 48°, distance framing the board with 10% margin; elevation 20°–80°, zoom 0.6×–2.2×; one finger orbits, two fingers zoom and pan. **Reset view** button and double-tap on the table. "Follow turns" (off by default) eases the orbit target a third of the way toward the acting player's cluster on `turnStarted`. The game end eases to a hero angle on the winner's largest cluster. Labels stay in the DOM: the steal popover is positioned by the projector.

## 4. Interaction

Invisible raycast meshes on layer 1 exist only for legal targets (spheres at vertices, boxes on edges, discs on hexes) with a pulsing ring, a glowing ghost plank or a rim glow in the acting player's colour, and a ghost piece on hover. Press and release on the same target dispatches; tapping the table cancels targeting; the camera and props are never raycast. In addition, transparent accessible `<button>`s are laid over the canvas at the projected position of every target (`data-testid="target-vertex-…"` etc.), so keyboard and assistive users, and the e2e specs, act without WebGL hit-testing.

## 5. Event animations

Dice tumble into a leather tray at the board's near edge with a decaying spin to a quaternion that lands the rolled face up (`faceUpQuaternion`); matching tokens bounce 0.1; the blocked tile shakes and its token dims; the robber hops in a parabola with squash-and-stretch; planks drop from 0.5 above with a dust ring; cottages scale up with overshoot and a smoke puff; keeps rise with a flag unfurl. Card flights, the dev card reveal, the turn banner and confetti remain DOM effects from Phase 7; the projector feeds them hex positions through the camera.

## 6. Quality

`Graphics: High / Medium / Low` in the settings menu, and that is the whole story: the preset is the player's outright, for the session. There is no auto tier, no device detection and no frame watchdog — picking a tier is the only thing that changes one. The tiers are deliberately close: **High** is **Medium** plus a 2048 shadow map (against 1024) and the rim light, and nothing else; **Low** is the one that really differs (no shadows, no antialiasing, reduced prop detail, idle motion off). High and Medium render at the true device pixel ratio capped at 2 (`resolveDpr`); Low renders at 1, which is the one preset that looks soft on a high-density display. The default is Medium. The screen logs `[katan] graphics preset: …` with the render and device pixel ratios whenever it changes.

Because nothing detects the device any more, a weak machine stays on whatever tier it is given: Medium runs shadows at 2x and a software renderer will not keep up. Every Playwright spec therefore pins its own preset in `localStorage`.

## 7. Tests

- `test/board3d.test.ts`: world coordinates equal the 2D layout for every ID; bounds and framing; seeded jitter; the interaction layer enables exactly the legal targets; seeded props respect density and stay inside the tile; the graphics tiers (High is Medium plus two things), the shadow camera fit against the board's projected corners, and the outline material's shader edit.
- `e2e/board3d.spec.ts` (Chromium on SwiftShader): the canvas renders, a vertex click through the raycast layer dispatches `BUILD_SETTLEMENT`, the overlay button dispatches the road, a bot turn stays within the Phase 7 budget, reset view and the graphics settings work.
- `e2e/visual.spec.ts`: default, top-down and zoomed screenshots against baselines in `e2e/__screenshots__` (3% pixel tolerance, Low preset so software and GPU renderers agree). Update with `--update-snapshots`.

## 8. Changes to later phases

The editor (Phase 8) renders its canvas with this scene in a top-down framing with ghost slabs for empty cells; thumbnails come from `board2d`. Ships and the pirate (Phase 9) are `ShipFigure` with the player's or a black sail.

## 9. Done criteria

- A full hotseat game plays on the 3D board; the online screen uses the same component.
- Every Phase 7 event has a scene or DOM animation; the queue gates input exactly as before.
- The 2D board is used nowhere in play (`board2d` is imported only by thumbnails).

## 10. Decisions and deviations

- **Numerals are canvas sprites**, not text geometry, so no font is fetched at runtime.
- **Accessible overlay buttons** were added on top of the raycast layer; they are not in the spec but keep the board usable without a mouse and make the tests deterministic.
- **Sea ripple and gulls** are in (docs/props.md §3): the three shared sea variants ripple 0.01 R at 0.6 Hz while idle motion is on, and a gull circles some sea tiles at Medium and above.
- **Deviations from the tile and prop brief** are listed in `docs/props.md` §7 (road length, DOM colours, wall levels, the island pennant).
- Post-processing multisampling is off (SwiftShader and mobile).
