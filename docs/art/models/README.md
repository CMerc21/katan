# Source models

The original Meshy exports for the diorama's figurines, kept under their
generated names as a provenance record. **Nothing loads these.** The copies
the game actually serves live in `apps/web/public/models/` under the names
`loadPiece` looks up (`apps/web/src/board3d/loadPiece.ts`); each is
byte-identical to its source here.

These files were first uploaded to `apps/web/app/public/models/`, which
Next.js does not serve — only `apps/web/public/` is — so they 404ed and every
piece fell back to its procedural figure. They were moved here, and served
copies were placed under the correct path, in the commits that follow the
upload.

| Source export | Served as | Piece |
| --- | --- | --- |
| `Meshy_AI_Shadow_Sentinel_0913183855` | `robber.glb` | the robber |
| `Meshy_AI_Cozy_Thatched_Cottage_0913190029` | `settlement.glb` | settlement |
| `Meshy_AI_Flagtop_Fortress_0913190037` | `city.glb` | city |
| `Meshy_AI_Wooden_Bridge_0913190049` | `road.glb` | road |
| `Meshy_AI_Flagtop_Fortress_0914121238` | `city_walled.glb` | city with a wall |
| `Meshy_AI_Crowned_Castle_Tower_0914121245` | `metropolis.glb` | metropolis |
| `Meshy_AI_Crownspire_Citadel_0914130809` | `metropolis_walled.glb` | metropolis with a wall |
| `Meshy_AI_Tiny_Shield_Knight_0914121311` | `knight_1.glb` | knight, level 1 |
| `Meshy_AI_Miniature_Slate_Knigh_0914121305` | `knight_2.glb` | knight, level 2 |
| `Meshy_AI_Stone_Sentinel_0914121258` | `knight_3.glb` | knight, level 3 |
| `Meshy_AI_Little_Wooden_Sailboa_0914121501` | `ship.glb` | ship |
| `Meshy_AI_Tattered_Viking_Longb_0914121251` | `barbarian_ship.glb` | barbarian longship |
| `Meshy_AI_Tiny_Shadow_Sailor_0914121326` | `pirate.glb` | pirate |
| `Meshy_AI_Green_Cart_Merchant_0914121320` | `merchant.glb` | merchant |
| `Meshy_AI_Rustic_Wooden_Signpos_0914121452` | `port_sign.glb` | harbour signpost |

Every export is a single mesh, pivoted at its centre, with no normals and no
material. World sizes, colour zones and the fallback rules are in
`docs/props.md`; the config itself is `PIECES` in `loadPiece.ts`.

## Tile props

The second upload: the terrain props, served from `apps/web/public/models/props/`
under the kind names the scatter rules use (`PROP_MODELS` in
`apps/web/src/board3d/propModels.ts`). Ten came with descriptive names; the
other fourteen were exported as `Meshy_AI_model` and were identified by eye
from a rendered contact sheet, so the "identified as" rows are a judgement
call — correct any that is wrong by renaming the served copy and its row in
`PROP_MODELS`.

| Source export | Served as | Prop | How named |
| --- | --- | --- | --- |
| `Meshy_AI_Low_Poly_Tree_0914140907` | `tree.glb` | round tree | by name |
| `Meshy_AI_Whimsywood_Tree_0914140845` | `tree_2.glb` | round tree, second variant | by name |
| `Meshy_AI_Low_Poly_Pine_Tree_0914140605` | `pine.glb` | pine | by name |
| `Meshy_AI_Stacked_Wooden_Logs_0914140901` | `log_pile.glb` | log pile (long on X) | by name |
| `Meshy_AI_Low_Poly_Sheep_0914140833` | `sheep.glb` | sheep (long on X) | by name |
| `Meshy_AI_Wooden_Fence_0914140839` | `fence.glb` | fence section (long on X) | by name |
| `Meshy_AI_Golden_Wheat_Sheaf_0914140856` | `wheat.glb` | wheat sheaf | by name |
| `Meshy_AI_Golden_Harvest_Bundle_0914140919` | `wheat_2.glb` | wheat sheaf, second variant | by name |
| `Meshy_AI_Whispering_Windmill_0914140914` | `windmill.glb` | windmill (sails face +Z) | by name |
| `Meshy_AI_Golden_Barrel_0914140850` | `hay_bale.glb` | round hay bale (long on X) | by name, confirmed by render |
| `Meshy_AI_model` | `peak.glb` | mountain peak | identified as |
| `Meshy_AI_model (1)` | `ridge.glb` | ridge (wide low mountain) | identified as |
| `Meshy_AI_model (2)` | `skull.glb` | cattle skull | identified as |
| `Meshy_AI_model (3)` | `flat_rock.glb` | flat rock | identified as |
| `Meshy_AI_model (4)` | `boulder.glb` | boulder | identified as |
| `Meshy_AI_model (5)` | `dry_bush.glb` | dry bush (tumbleweed) | identified as |
| `Meshy_AI_model (6)` | `rubble.glb` | rocky outcrop (long on X) | identified as |
| `Meshy_AI_model (7)` | `cactus.glb` | saguaro cactus | identified as |
| `01a0a044-8add-…/Meshy_AI_model` | `mound_wide.glb` | clay mound, wide terraced | identified as |
| `01a0a044-8ade-…/Meshy_AI_model` | `kiln.glb` | beehive kiln | identified as |
| `01a0a044-8ae1-…/Meshy_AI_model` | `mound_low.glb` | clay mound, low double (long on X) | identified as |
| `01a0a044-8aeb-…/Meshy_AI_model` | `mound_tall.glb` | clay mound, tall | identified as |
| `01a0a044-8af7-…/Meshy_AI_model` | `brick_stack.glb` | brick stack (long on X) | identified as |
| `01a0a044-8b03-…/Meshy_AI_model` | `mound_terraced.glb` | clay mound, stepped | identified as |

No prop for the pasture **bush** was uploaded; it draws procedurally until one
is. None of the props carries a baked texture yet, so each is a flat palette
colour; a textured re-export is picked up automatically (`propMaterial`).
