# Katan — Rules

This document is the source of truth for the rules engine in `packages/engine`. Section numbers are referenced from tests and code comments. When a rule is ambiguous, decide, then record the decision here.

All names below (terrain, resources, pieces, cards) are the canonical names used in code.

## §1 Overview

* 3 or 4 players. Seats are numbered 0..n-1 in seat order; play proceeds in increasing seat order and wraps.
* The first player to reach **10 victory points (VP)** on their own turn wins (§11).
* Play consists of a **setup phase** (§4) followed by repeating **turns** (§6–§9) until someone wins.

## §2 Components

### §2.1 Terrain and resources

The board has 19 hexes. Each hex has one terrain. Five terrains produce one resource each; wasteland produces nothing.

| Terrain    | Count | Produces |
|------------|-------|----------|
| `forest`   | 4     | `wood`   |
| `claypit`  | 3     | `clay`   |
| `meadow`   | 4     | `wool`   |
| `farmland` | 4     | `grain`  |
| `mountain` | 3     | `ore`    |
| `wasteland`| 1     | nothing  |

### §2.2 Number tokens

18 tokens, one on every hex except the wasteland: `2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12`. There is no 7.

**The 6/8 rule:** no two hexes carrying a 6 or an 8 may be adjacent (share an edge). Both the beginner board and every generated board honor this.

### §2.3 Bank

The bank starts with **19 of each resource** (95 cards total). Resources are never created or destroyed; every card is either in the bank or in a player's hand.

### §2.4 Player pieces

Each player starts with **15 roads, 5 settlements, 4 cities**. A player who has no piece of a kind left cannot build that kind. Upgrading a settlement to a city returns the settlement piece to the player.

### §2.5 Development cards

25 cards in a seeded, hidden deck: 14 `knight`, 5 `victoryPoint`, 2 `roadBuilding`, 2 `invention`, 2 `monopoly`. See §8. (`invention` is the "take two resources from the bank" card; the engine never uses the commercial game's card names.)

### §2.6 Ports

Nine ports sit on fixed boundary edges of the board. A port belongs to the two vertices of its edge. Four ports are generic (`any`, 3:1) and five are resource-specific (2:1), one per resource. See §9.2.

### §2.7 Special cards

* **Longest Road** — 2 VP, held by the player with the longest continuous road of at least 5 (§10.1).
* **Largest Army** — 2 VP, held by the player who has played the most knights, at least 3 (§10.2).

### §2.8 Victory points

Settlement 1 VP, city 2 VP, Longest Road 2 VP, Largest Army 2 VP, each `victoryPoint` card 1 VP (hidden until the win check, §11).

## §3 Geometry

### §3.1 Hexes

Hexes use **axial coordinates** `(q, r)` with implicit `s = -q - r`, pointy-top orientation. The board is every hex with `max(|q|, |r|, |s|) <= 2`: 19 hexes. Hex ID is the string `"q,r"`.

The six neighbour directions, in counter-clockwise angular order, are:
`(+1,0), (+1,-1), (0,-1), (-1,0), (-1,+1), (0,+1)`.

Hexes outside the board (radius 3) are **virtual**: they exist only to give boundary vertices and edges canonical IDs. They have no terrain and never produce.

### §3.2 Vertices

A vertex is the meeting point of exactly three hexes (real or virtual). Its canonical ID is the three hex IDs sorted by `(q, r)` and joined with `|`, e.g. `"-1,0|0,-1|0,0"`. The board has **54 vertices**. A vertex is on the board if at least one of its hexes is real.

Corner `k` of a hex `H` (k = 0..5) is the vertex shared by `H`, `neighbour(H, k)`, and `neighbour(H, (k+1) mod 6)`.

### §3.3 Edges

An edge is the boundary between exactly two hexes (real or virtual). Its canonical ID is the two hex IDs sorted and joined with `|`. The board has **72 edges**. An edge is on the board if at least one of its hexes is real. An edge with exactly one real hex is a **boundary edge**; there are 30.

The two vertices of edge `{A, B}` are the two hexes `C` adjacent to both `A` and `B`, i.e. vertices `{A,B,C}`.

### §3.4 Adjacency

* Two vertices are adjacent if they share an edge. Every vertex has 2 or 3 adjacent vertices.
* A vertex touches the hexes in its ID (only real hexes produce).
* A hex has 6 vertices and 6 edges.

### §3.5 Spiral order

"Spiral order" lists the 19 hexes as: the radius-2 ring starting at `(-2, 2)` walking direction 0, then 1, … then 5 (12 hexes); then the radius-1 ring starting at `(-1, 1)` the same way (6 hexes); then the centre `(0, 0)`. Board layouts are specified in spiral order.

### §3.6 Port positions

Boundary edges are ordered by the angle of their midpoint around the centre (ascending `atan2`). Ports occupy the boundary edges at indices `0, 3, 7, 10, 13, 17, 20, 23, 27` of that order. No two port edges share a vertex.

## §4 Setup

### §4.1 Order

With seats `0..n-1`, setup placements happen in **snake order**: `0, 1, …, n-1, n-1, …, 1, 0`. Each player places twice: one settlement and one road per placement, settlement first, then the road.

### §4.2 Placement rules during setup

* A setup settlement may go on any on-board vertex that is empty and satisfies the **distance rule** (§5.3): no building on any adjacent vertex. No road connection is required.
* A setup road must be placed on an empty on-board edge touching the settlement just placed by the same player.
* Nothing is paid for setup pieces.

### §4.3 Starting resources

Immediately after a player's **second** settlement is placed, they receive one resource from the bank for each real producing hex touching that settlement (wasteland gives nothing). The first settlement gives nothing.

### §4.4 Robber

The robber starts on the wasteland.

### §4.5 End of setup

After the last road of the snake, the main phase begins with seat 0's first turn. Nothing has been rolled yet.

## §5 Building

### §5.1 Costs

| Piece / card       | Cost                                 |
|--------------------|--------------------------------------|
| Road               | 1 `wood`, 1 `clay`                   |
| Settlement         | 1 `wood`, 1 `clay`, 1 `wool`, 1 `grain` |
| City (upgrade)     | 2 `grain`, 3 `ore`                   |
| Development card   | 1 `ore`, 1 `wool`, 1 `grain`         |

Resources paid go back to the bank. Building is allowed only on the player's own turn after the dice have been rolled (§6.1) and any pending robber/discard steps (§7) are complete.

### §5.2 Roads

A road goes on an empty on-board edge that touches one of the player's own roads, settlements, or cities. A road may not be extended *through* another player's settlement or city: a connection via a vertex occupied by an opponent's building does not count.

### §5.3 Settlements

A settlement goes on an empty on-board vertex that (a) touches one of the player's own roads and (b) satisfies the **distance rule**: no settlement or city (anyone's) on any adjacent vertex.

### §5.4 Cities

A city replaces one of the player's own settlements on the same vertex. The settlement piece returns to the player's supply.

### §5.5 Piece limits

A build is illegal if the player has no piece of that kind left (§2.4).

## §6 Turn and production

### §6.1 Roll

A turn begins with rolling two six-sided dice (seeded, §12). The roll happens once per turn, before any building or trading. A knight may be played before rolling (§8.2); after its robber move and steal, play returns to the roll step.

### §6.2 Production

On any total other than 7, every real hex whose token equals the total and does not hold the robber produces: **1** of its resource per adjacent settlement and **2** per adjacent city, for each owner.

**Bank shortage:** production is resolved one resource type at a time. If the bank cannot pay everything owed of a resource:
* if exactly one player is owed that resource, they receive whatever the bank has left;
* if two or more players are owed that resource, **nobody** receives any of it this roll.
Other resource types are unaffected.

### §6.3 Turn structure

After the roll (and §7 if a 7): the player may, in any order and any number of times, trade (§9), build (§5), and play at most one development card (§8). The turn ends with an explicit end-turn action. Play passes to the next seat.

## §7 Rolling a seven

### §7.1 Discard

When a 7 is rolled, every player holding **more than 7** resource cards discards **half, rounded down**, of their choice, to the bank. All discards must be resolved before the robber moves.

### §7.2 Move the robber

The rolling player must move the robber to a different hex (any hex, including the wasteland). That hex does not produce while the robber is on it.

### §7.3 Steal

If any *other* player with at least one resource card has a settlement or city on the new hex, the rolling player chooses one such player and takes one random resource card from their hand (seeded, §12). Players with empty hands are not valid targets. If there is no valid target, the steal step is skipped automatically.

## §8 Development cards

### §8.1 Buying

Cost per §5.1; the top card of the seeded deck goes to the buyer's hand. If the deck is empty, buying is illegal.

### §8.2 Playing

* At most **one** development card may be played per turn (`victoryPoint` cards are never "played"; they count at the win check).
* A card may not be played in the turn it was bought.
* `knight` may be played before or after rolling; all others only after rolling.

### §8.3 Effects

* `knight` — move the robber and steal exactly as in §7.2–§7.3. Increments the player's played-knight count (§10.2).
* `roadBuilding` — place up to two roads for free following §5.2. If the player has one road piece left, place one; with no road pieces or no legal edge at all the card cannot be played. If the second road has nowhere legal to go after the first, the effect ends after one.
* `invention` — take any two resources from the bank (may be the same). Limited by bank stock.
* `monopoly` — name a resource; every other player gives all of that resource to the player.
* `victoryPoint` — 1 VP, hidden from other players until §11.

## §9 Trading

### §9.1 Domestic trade

Only on the current player's turn, after the roll. The current player posts an **open offer** (giving ≥1 resource, receiving ≥1 resource, no resource on both sides) that any other player may accept. Only one offer may be open at a time.

* The first player to accept executes the trade atomically; the acceptor must hold the requested cards.
* A player who declines is removed from that offer; once every other player has declined, the offer clears.
* The offerer may withdraw the offer at any time; ending the turn withdraws it; and if the offerer spends the offered cards, the offer is withdrawn automatically.
* Other players may not trade among themselves.

### §9.2 Maritime trade

The current player may trade with the bank at any time after the roll:
* **4:1** — four of one resource for one of any resource, always available.
* **3:1** — three of one resource for one of any, if the player has a settlement or city on a vertex of an `any` port.
* **2:1** — two of a specific resource for one of any, if the player has a building on a vertex of that resource's port.
The bank must hold the requested resource.

## §10 Longest Road and Largest Army

### §10.1 Longest Road

* The length of a player's road is the longest trail (no edge reused; vertices may repeat) through their own roads. An opponent's settlement or city on a vertex breaks the trail at that vertex.
* The first player to reach length **5** takes Longest Road (2 VP). Another player takes it only by **exceeding** the holder's length. A tie with the holder leaves the card where it is.
* If the holder's length drops below 5 (a road cut by an opponent's settlement), the card is lost. It then goes to the unique player with the longest road of at least 5, or to nobody if there is a tie or no one qualifies.
* If the holder still qualifies but two or more other players exceed them with equal lengths (possible only when a settlement shortens the holder's road), nobody holds the card until one player is uniquely longest.
* The card is re-evaluated after every road and every settlement.

### §10.2 Largest Army

The first player to have played **3** knights takes Largest Army (2 VP). Another player takes it only by exceeding the holder's count. Ties leave the card where it is.

## §11 Winning

After every action, the engine checks the **current player's** VP (§2.8, including hidden `victoryPoint` cards). If it is **10 or more**, the game ends immediately and that player wins. VP is never checked for players whose turn it is not, so a player who reaches 10 during an opponent's turn (for example by receiving Longest Road when a road is cut) wins at the start of their own next turn, provided they still have 10 then.

## §12 Randomness

Every random event is derived from the game's seed plus an integer index: `rng(seed, index)`.

* Dice and stolen cards use the index of the action that caused them (`actionIndex` before the action is applied).
* The development deck is shuffled with index `-1`; the random board with index `-2`.

The engine never reads a clock or an unseeded random source. Replaying the action log from the seed reproduces the game exactly. The human-readable `log` in the state keeps only the most recent 100 entries; the action log is the audit trail.

## §13 Larger tables and custom boards

### §13.1 Boards of any shape

A game may be played on any board built in the editor: a set of land hexes (any connected shape of at least seven), optional decorative sea and frame hexes, harbours on coastal edges only, and a seat cap the board can support. The hex, vertex, edge, distance and connection rules of §3–§5 apply unchanged; unfilled terrain, tokens and harbours are drawn at game start from pools scaled to the land count (the 6/8 rule of §3 always holds).

### §13.2 Five and six players

Up to six players may sit at a board whose seat cap allows it. Piece counts per player are unchanged. With five or six players, after a player ends their turn every other player, in seat order, gets a **special build**: they may build roads, settlements and cities and buy development cards at the usual prices. They may not trade or play development cards. When the last special builder is done, the next turn begins with its roll. Winning (§11) is checked after every build, including special builds.
