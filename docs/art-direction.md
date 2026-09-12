# Art direction

Original medieval tabletop look for Katan (docs/phase7.md §6, docs/phase7-5.md §1). Nothing is borrowed from any commercial game: every shape is drawn from primitives in this repo.

## §1 Palette

| Token | Hex | Use |
|---|---|---|
| walnut | `#3b2a1e` | table surface (3D) and page background |
| walnut-light | `#5a4030` | table grain highlights |
| parchment | `#efe8d8` | panels, cards, token discs |
| parchment-deep | `#e3dac6` | panel edges, secondary surfaces |
| ink | `#211d19` | outlines, body text |
| ink-soft | `#4a433c` | secondary text |
| wax | `#9b2226` | primary buttons (wax seal red) |
| wax-deep | `#6f1519` | pressed / hover |
| gilt | `#c9a227` | accents, 6/8 numerals' frame, glints |
| forest | `#3e6b46` / marks `#2b4d32` | forest tiles, pines |
| claypit | `#b25a3d` / marks `#8a4330` | hills, kilns, bricks |
| meadow | `#a5b95e` / marks `#7d9143` | pasture, sheep wool `#f1eee5` |
| farmland | `#d9a642` / marks `#b0812c` | fields, wheat |
| mountain | `#7d8089` / marks `#5b5e66` | mountains, snow `#f4f4f2` |
| wasteland | `#cfbd8e` | desert dunes |
| gold | `#e0b43a` glow `#ffe27a` | gold terrain (Phase 9) |
| water | `#4a7d8c` / deep `#3b6674` | sea, lakes |
| hot token | `#c8412b` | 6 and 8 numerals |

Player colours are heraldic tinctures:

| Seat colour | Name | Hex | Text on it |
|---|---|---|---|
| red | gules | `#a12a1e` | white |
| blue | azure | `#2a4d8f` | white |
| orange | or | `#d9a21b` | ink |
| white | argent | `#e8e4d8` | ink |
| green | vert | `#2f6b3a` | white |
| brown | tenné | `#7a4a1f` | white |

## §2 Type

* Display (title, turn banner, win screen): `"Cinzel", "Trajan Pro", "Luminari", "Palatino Linotype", Georgia, serif` in small caps with tracking; legibility first, so no true blackletter at small sizes.
* Body: `"Palatino Linotype", Palatino, "Book Antiqua", "Iowan Old Style", Georgia, serif`.
* Counts and scores use tabular numerals. Number tokens' 6 and 8 get an illuminated-capital frame (gilt ring).

## §3 Surfaces

* Panels are parchment with an SVG fiber filter (`feTurbulence`, no raster) and a single ink rule.
* Buttons: primary is wax red with a slight inner bevel; secondary is ink outline on parchment.
* The turn banner is a heraldic ribbon in the player's colour with forked ends.
* Dice are bone (`#f2ead6`) with pip indents in a leather tray (`#4a2f1c`).

## §4 Pieces

* Roads: timber planks with two stakes. Settlements: thatched cottages (parchment walls, straw roof, player-colour door and base ring). Cities: stone keeps with a banner in the player's colour. Ships: hull plus a triangular sail in the player's colour. Robber: hooded figure with a sack. Pirate: black-sailed ship.
* Harbors: a wooden pier with a hanging sign showing the ratio and the resource icon.
* Pieces are drawn at about 1.5× true scale so they read from the default camera.
