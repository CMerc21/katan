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

## §14 Tides (sea module)

Tides is on when a scenario enables it. Without it nothing in this section applies.

### §14.1 Sea, islands and scenarios

Sea hexes become playable: ships may be built on edges that touch at least one sea hex. Frame hexes never are. Land need not be connected; each connected group of land hexes is an **island**. A scenario bundles a board with the module switches, the pirate switch, the island bonus, a setup restriction (start on the main island only) and the number of victory points needed to win (§11 uses that number instead of 10).

### §14.2 Ships

A ship costs 1 wood and 1 wool; each player has 15. A ship is placed on a sea edge connected to one of the player's settlements or cities or to one of their ships, never directly to a road: roads and ships meet only at a settlement or city. A chain of a player's ships is a **shipping route**; it is **open** when one end has neither a settlement, a city nor another ship of theirs. Once per turn, in the action phase, the player may move the ship at the open end of a route to another legal position connected to any of their routes, provided that ship was not built this turn and is not on an edge of the pirate's hex. A settlement may be built at the end of a shipping route (subject to the distance rule); in setup a coastal settlement's free road may be a ship instead. Road Building may place ships as well as roads. **Longest route** replaces Longest Road: the longest continuous trail of roads and/or ships, where a road and a ship join only through the player's own settlement or city; the same threshold and transfer rules as §10.1 apply.

### §14.3 Gold fields

A gold field is a producing terrain with a number token. When its number is rolled, each adjacent settlement owes its owner one resource of the owner's choice and each city two. Owing players choose in seat order from the current player, one player at a time, before play continues; a choice must be paid by the bank (a player owed more than the bank holds takes what is left). A second setup settlement beside a gold field is owed one resource the same way.

### §14.4 Island bonus

When the scenario sets an island bonus, the first time a player builds a settlement on an island that none of their setup settlements touched, they receive a permanent victory point chip worth the bonus. Each island pays at most once per player.

### §14.5 The pirate

The pirate is a second blocker that lives on sea hexes; a scenario may leave it out. On a seven or a knight the player moves either the robber to a land hex or the pirate to a different sea hex. No ship may be built on or moved to an edge of the pirate's hex, and ships on those edges may not move. After moving the pirate the player steals one random card from a player who has a ship on an edge of the pirate's hex, as in §7.3.

### §14.6 Setup on the main island

When the scenario restricts setup to the main island, both setup settlements must touch a hex of that island. Later settlements may go anywhere the rules allow.

## §15 Wayfarers (variants module)

Wayfarers is a set of independent switches a scenario may combine (`scenario.variants`). Each applies only when it is on; with every switch off nothing in this section applies. Raiders (§15.5) cannot be combined with Crown & Castle (§16).

### §15.1 Event deck

The dice are replaced by a deck of 36 cards whose numbers follow the two-dice distribution (one 2, two 3s, three 4s, four 5s, five 6s, six 7s, five 8s, four 9s, three 10s, two 11s, one 12). A roll draws the top card; its number counts as the total for §6–§7. Five cards also carry an event, resolved after the number: the **12** is *Plentiful harvest* (every player takes one resource of their choice from the bank, in seat order from the current player, as for gold in §14.3); the **2** is *Bounty* (the current player takes one resource of their choice); one **7** is *Robber's rest* (players over the limit still discard, but the robber does not move); one **3** is *Neighborly help* (every player other than the one with the fewest victory points may, in seat order from the current player, give that player one card; ties for fewest go to the earliest seat from the current player); one **11** is *Tax collector* (every player holding eight or more cards puts one card of their choice back in the bank). The deck is shuffled from the seed; the fifth card from the bottom is the reshuffle marker: after the roll that draws it, the deck is rebuilt and shuffled again.

### §15.2 Fishing

A **lake** is a land terrain that produces nothing and carries no number token; the robber starts there when the board has no wasteland. A **fishing ground** is a coastal edge with its own number token. Fish are counted as points. The fish bag holds thirty tokens: eleven worth 1, ten worth 2, eight worth 3, and the **old boot**. Tokens are drawn from the top of the seeded bag; an empty bag draws nothing.

When a fishing ground's number is rolled, each settlement on either vertex of its edge draws one token and each city two, in seat order from the current player. On any roll of 2, 3, 11 or 12, each settlement adjacent to a lake draws one token and each city two, unless the robber stands on that lake.

On their own turn, in the action phase, a player may spend fish any number of times: **2** fish move the robber to a lake or a wasteland (another one than where it stands; no steal); **3** fish take one random card from any other player; **4** fish take one resource of choice from the bank; **5** fish build a road for free on a legal edge; **7** fish draw a development card for free, or, when the deck is empty, upgrade one of the player's settlements to a city for free.

The old boot is worth −1 victory point to whoever holds it. Its holder may pass it along with a domestic trade (§9.1), either attached to their own offer or to their acceptance of another player's offer, to a player whose victory points (counted without the boot) are at least the holder's. The boot counts at the win check.

### §15.3 Rivers

River segments are edges of the board. A road built on a river edge is a **bridge** and costs one extra clay. The player with the most bridges, at least three, holds **Bridge Builder** (1 VP); another player takes it only by exceeding the holder's count, and if the holder is exceeded by two players who tie, nobody holds it. A settlement or city is **riverside** when at least one edge at its vertex is a river segment. At the end of a player's turn they receive one gold coin per riverside settlement and two per riverside city. The unique player with the fewest coins holds the **Poor Settler** (−2 VP); a tie for fewest leaves it with nobody. Both chips are re-evaluated whenever a road is built or coins are awarded.

### §15.4 Harbormaster

Each settlement on a harbour vertex is worth one harbour point and each city two. The first player to reach three harbour points takes the **Harbormaster** (2 VP); another player takes it only by exceeding the holder's points.

### §15.5 Raiders

Immediately after placing their second setup settlement, each player chooses one of their settlements to be their **castle** (1 VP). The castle vertex is never counted by the raiders and can neither be captured nor raided; it may still become a city.

A raider counter starts at 0. Every time a seven is rolled, before the robber moves, it advances by the number of cities on the board. When it reaches 15 the raiders **land**: every coastal land hex (a land hex with at least one neighbour that is not land) is attacked with strength equal to one per settlement and two per city on its vertices (castle vertices count zero); its defence is the number of guards standing on it. A hex whose strength exceeds its defence is **raided**: it produces nothing until rebuilt, and the guards on it are removed. A hex with zero strength is ignored. The counter then resets to 0.

A **guard** costs one ore and one wool and is placed on a land hex the player has a building on; a player may have at most six guards; several guards may share a hex. Any player may, in their action phase, pay one ore and one wool to **rebuild** a raided hex; it produces again and the rebuilder scores 1 VP.

### §15.6 Caravans

An **oasis** is a land hex marked in the editor; it keeps a number token but yields **spice** instead of its resource: one per adjacent settlement and two per adjacent city when its number is rolled (blocked by the robber; the spice bank holds 19). Oases give no starting resources. Each oasis is the start of a **caravan track** of up to three edges. In the action phase the current player may pay one spice to extend a caravan by one edge onto one of their own roads that continues the track: for an empty track any of the oasis's six edges, otherwise an edge sharing a vertex with the track's last edge and not already on it. Every road on a caravan track, or sharing a vertex with one, counts double for Longest Road (§10.1). A settlement or city on a vertex of a caravan track receives one extra resource whenever an adjacent producing hex's number is rolled (subject to the bank).

### §15.7 Wagons

Each player's **wagon** starts on their second setup settlement. In the action phase the wagon moves along roads of any player, from vertex to vertex; the first two steps of a turn are free and each further step costs one grain. Entering a vertex where an opponent's wagon stands requires a toll of one resource paid to that wagon's owner. At the end of every turn each city on the board stocks one good (marble, glass, sand or tools; the kind is fixed per city from the seed, at most two goods waiting), and every city shows a demand for one kind of good, rotating after each delivery. A wagon standing at a city may load a waiting good (it carries at most two) and, standing at a city of another player, may deliver a good it carries for one victory point, or two when the good matches that city's demand.

## §16 Crown & Castle (cities module)

Crown & Castle is on when a scenario enables it. There are no development cards and no Largest Army; the deck is empty. The scenario's target is normally 13 victory points.

### §16.1 Commodities

Three commodities join the five resources: **cloth**, **coin** and **paper**, twelve of each in the bank. A city on a meadow yields one wool and one cloth, on a mountain one ore and one coin, on a forest one wood and one paper; on farmland and clay pits a city still yields two of the resource, and settlements are unchanged. Commodities are paid in seat order from the current player while the bank lasts. Commodities count toward the hand limit (§7.1), may be discarded and stolen like resources, and trade with the bank at 4:1, or at 2:1 for a player at trade level 3.

### §16.2 The event die

Every roll adds an event die with three **fleet** faces and one **trade**, **politics** and **science** face; the first number die is the red die. A fleet face advances the barbarian fleet (§16.6). A track face lets every player whose improvement level on that track is at least the red die minus one draw a progress card of that track (a red 1 never pays; level 5 draws on 2–6). A player holding more than four progress cards (revealed victory point cards do not count) discards down to four at once, returning cards to the bottom of their deck.

### §16.3 City improvements

Each player advances three tracks — trade (paid in cloth), politics (coin) and science (paper) — from level 0 to 5; level n costs n cards of the track's commodity. A player needs at least one city (a metropolis counts) to build an improvement. Level 3 grants an ability: trade level 3 trades commodities with the bank at 2:1; politics level 3 allows knights of level 3; science level 3 gives the player one resource of their choice whenever a roll other than a seven brings them nothing. Level 4 and 5 relate to metropolises (§16.7).

### §16.4 Progress cards

Three hidden decks (eighteen trade and politics cards, seventeen science cards), one per track, shuffled from the seed. A player may play any number of progress cards on their turn, but at most one before rolling; Alchemist is played only before the roll, politics cards, Inventor, Irrigation and Mining before or after it, and every other card only after it. Bishop obeys the first-attack rule of §16.5. Constitution and Printer are victory point cards: they are revealed when drawn and score one point each permanently. The other cards do what their name says: Merchant (place the merchant on a hex you have a building on; you trade that hex's resource at 2:1 while it stays, and it is worth 1 VP), Trade Monopoly (every other player gives you one of a named commodity), Resource Monopoly (every other player gives you up to two of a named resource), Master Merchant (take two random cards from a player with more victory points), Merchant Fleet (trade one named resource or commodity at 2:1 this turn), Commercial Harbor (every other player holding a commodity must swap one of their choice for one of your resources, once each), Bishop (move the robber and take one random card from every player with a building on the new hex), Deserter (a player of your choice removes one of their knights and you place one of the same level, inactive, on your network), Diplomat (remove an open road — one with a free end — of any player; your own may be placed again elsewhere), Intrigue (remove an opposing knight standing on a vertex your roads touch), Saboteur (every player with more victory points than you discards half their cards), Spy (look at a player's progress cards and take one), Warlord (activate all your knights for free), Wedding (every player with more victory points gives you two cards of their choice), Alchemist (choose both number dice before rolling; the event die is still random), Crane (your next improvement costs one commodity less), Engineer (build a city wall for free), Inventor (swap the number tokens of two hexes numbered 3, 4, 5, 9, 10 or 11), Irrigation (two grain per farmland hex you have a building on), Medicine (upgrade a settlement to a city for two ore and one grain), Mining (two ore per mountain hex you have a building on), Road Building (two free roads), Smith (promote up to two of your knights one level for free; level 3 still needs politics level 3).

### §16.5 Knights

Knights are pieces at vertices connected to the player's roads; each player has two knights of each level (1 basic, 2 strong, 3 mighty). Building a knight costs one wool and one ore and places a level-1 knight, inactive. Activating costs one grain; a knight activated this turn cannot act until the next turn. Promoting costs one wool and one ore per level, and the next level's piece must be in supply; level 3 needs politics level 3. Each active knight that has not acted this turn may do one of: **move** to a free vertex on the player's road network reachable along their own roads; **displace** a weaker opposing knight there (its owner moves it to a free vertex on their own network reachable from where it stood, or loses it); **chase** the robber off a hex adjacent to the knight (the player moves it and steals as in §7.2–§7.3); or, by standing on a vertex of an opponent's road, **break** that road for Longest Road. Acting deactivates the knight. No settlement may be placed on a vertex holding a knight, and a road cannot connect through a vertex holding an opposing knight. The robber does not move on a seven until the fleet has attacked once; discards still apply.

### §16.6 The barbarian fleet

The fleet track has seven steps. Each fleet face on the event die advances it; on the seventh step the fleet attacks. Its strength is the number of cities on the board (metropolises included); the realm's defence is the sum of the levels of every active knight. If the defence is at least the strength, the player with the single highest defence (above zero) becomes **Defender of the Realm** (1 VP; six chips exist); if several tie for highest, each instead draws a progress card of the track where they are most advanced. If the defence is below the strength, every player with the lowest defence among those who have a city without a metropolis loses one city of their choice, which becomes a settlement again (its wall is lost). After any attack every knight becomes inactive and the track resets.

### §16.7 City walls and metropolises

A wall costs two clay and goes on one of the player's cities (one per city, three per player); each wall raises that player's discard limit (§7.1) by two. A wall is lost with its city. The first player to reach level 4 on a track places that track's **metropolis** on one of their cities (2 VP; it cannot be lost to the barbarians). A player who reaches level 5 on that track takes the metropolis from a holder at level 4 (never from another player at level 5).

### §16.8 Victory

Settlements 1, cities 2, each metropolis 2 more, Longest Road 2, each Defender chip 1, each revealed victory point progress card 1, the merchant 1 while held. The first player to reach the scenario's target on their own turn wins (§11).
