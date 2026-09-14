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
