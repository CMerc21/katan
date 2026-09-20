# Phase 7.5 — 3D Diorama Board

Companion to `docs/phase7.md` and `docs/art-direction.md`. The board in play is now a Three.js diorama rendered with react-three-fiber (`apps/web/src/board3d`). Engine, events, drivers, dialogs and panels are untouched; the animation queue, skip and speed settings are unchanged. The old SVG board lives in `apps/web/src/board2d` and draws thumbnails only. §10 lists decisions and deviations.

## 1. Look

The tile and prop brief in `docs/props.md` is the target for everything below; it translates the reference renders in `docs/art/reference/` into geometry.

- **Tiles:** crisp-edged hex slabs with a 0.03 R corner radius (`slab.ts`), land in two layers (0.12 R terrain colour over 0.10 R earth brown, a tan band on mountains), a circular centre recess for the token, and a seeded low-poly relief on the top face. Sea slabs are 0.15 R, one colour with a lighter faceted top that ripples; the frame is a flat walnut slab. Seeded rotation (±0.4°) and height jitter (±1.5%) per tile (`tileJitter`).
- **Props:** `propsForHex(hex, terrain, density)` lays out a seeded cluster per tile from the brief's recipes (pines, oaks, a log cabin, log piles, stumps; sheep, a stone hut, fences; wheat rows around the recess and a windmill; terraced mounds, a kiln, a brick stack, a cart; snow peaks, a mine, nuggets; a saguaro, rocks, bones; crests and a gull on the sea; reeds on lakes; a sluice on gold). Each terrain's hero prop is always present; props keep off the recess and a 0.06 R edge margin and stand on the slab's relief. Every static kind is one merged, face-coloured geometry drawn as an `InstancedMesh`; windmills turn, kilns puff smoke, sheep bob, wheat sways and the gull circles as animated components. A standard board is under 40 draw calls for props.
- **Materials:** flat-shaded `MeshStandardMaterial`; the only textures are the table grain, token faces, harbour signs and the event die's fleet glyph, all baked on a canvas at runtime. Dice pips are geometry.
- **Light:** a warm directional key from azimuth −40°, elevation 42° with PCF soft shadows (2048 map on High, 1024 on Medium) fitted to the land bounds, a cool rim opposite it, a small sky/ground hemisphere fill, and a procedural image-based light (`environment.ts`) on `scene.environment`; `NeutralToneMapping` at exposure 1.18; a walnut table. Vignette and tilt-shift post-processing on High and Medium; contact shadows under the pieces on High. Details in `docs/props.md` §6.
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

`Graphics: Auto / High / Medium / Low` in the settings menu. Auto detects from GL limits, device pixel ratio, cores and a software-renderer check (`detectQuality`). Presets: High (shadows at 2048, post-FX, contact shadows, full props), Medium (shadows at 1024, post-FX, no contact shadows, 70% props), Low (no shadows, no post-FX, no antialiasing, 40% props, idle motion off, and a stronger environment intensity to make up the missing fill). High and Medium carry the image-based light; Low does not (it is the software-renderer preset and the per-fragment cost more than doubles its frame time), and raises its hemisphere fill instead. High and Medium render at the true device pixel ratio capped at 2 (`resolveDpr`); Low renders at 1, which is the one preset that looks soft on a high-density display. `FrameWatchdog` runs only while the setting is Auto: it ignores the first 5 s after mount (and after each step-down), a stall over 1 s (a hidden tab) clears its window, and it steps down one level when at least 75% of the frames in a 5 s window took over 33 ms. A single hitch or a fast frame in the middle changes nothing. The step-down is session state in `GameScreen`; it is never written to the settings or the profile, and picking High / Medium / Low by hand is a manual override the watchdog cannot change. The menu shows the active preset and its source (`quality-active`), and the screen logs `[katan] graphics preset: …` with the render and device pixel ratios whenever it changes.

## 7. Tests

- `test/board3d.test.ts`: world coordinates equal the 2D layout for every ID; bounds and framing; seeded jitter; the interaction layer enables exactly the legal targets; seeded props respect density and stay inside the tile; quality detection, step-down and the watchdog on a synthetic slow-frame signal.
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
- **Frame watchdog** warms up again for 5 s after each step-down so a second can follow a first, but the new preset's own shader compiles never count.
- Post-processing multisampling is off (SwiftShader and mobile).
