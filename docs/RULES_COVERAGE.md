# Rules Coverage (Engine V1 through Checkpoint 31)

This document records what the engine implements and what it intentionally does not. It is not a complete CR translation.

## Implemented

- 2–4 player Commander game state, turns, priority, and a last-in first-out stack.
- Zone movement with owner-zone integrity, including a `removed` zone for players who have left the game.
- Casting spells from hand, playing one land per turn, combat declarations, concede.
- Choose-on-cast targeting; legality at cast and again on resolve. If no legal targets remain, the spell’s effects are skipped (fizzle) and the card still goes to its destination. Targets may be players, creatures, or spells on the stack.
- Hidden information projection: opponent hands and libraries hide card identity; battlefield, graveyard, exile, command, stack, life, and commander damage stay public. The UI shows `GameHost.viewFor`, not raw authority.
- Basic effects: damage, life, draw, mill (mill what’s there), discard (front of hand), sacrifice, counters, tokens, tap/untap, mana, zone moves.
- `tap_for_mana` for permanents whose definition has `produces`.
- A 21-card synthetic pool and catalog seating (`startCatalogGame`). Still available from the start screen.
- Real cards: Scryfall-shaped `OracleCard` data compiles into `CardDefinition`. Instant/sorcery oracle text is not executed. Creatures get printed P/T and known keywords. Lands/artifacts get `produces` only for a single simple `{T}: Add {M}` line.
- Deck import: Moxfield public URL (Electron IPC) or pasted Commander/Arena text. `startDefinitionGame` shuffles and seats 2, 3, or 4 players. Empty opponent URLs mirror your deck. Compile notes are shown; uncompiled cards stay in the deck.
- Local React battlefield for 2, 3, or 4 players. Actions go through `GameHost.submit`. Optional local hotseat seats every player at this PC; otherwise unseated opponents auto-pass. Authority persists in localStorage. Oracle cache key `mtgcommander.oracle.v1`. Not a networked client.
- Keywords: flying, reach, haste, vigilance, trample, deathtouch, lifelink, first strike, double strike, menace, hexproof, indestructible, flash, defender.
- Derived power/toughness: printed values, `p1p1` counters, and simple static P/T modifiers (`self` or `controlled_creatures`).
- Enter-the-battlefield triggers become stack abilities. No target choices and no AP-order for simultaneous triggers.
- Draw replacement: a controlled `replace_draw` / `skip` permanent skips draws.
- State-based actions: 0 life, 21 commander damage, 0 toughness (0 toughness dies even if indestructible), and failing to draw from an empty library. Lethal damage destruction still runs after combat damage.
- Stack targeting: spells on the stack can be chosen (`kind: "spell"`). Test Counter counters a targeted spell; the countered card goes to the graveyard (commanders still return to the command zone).
- Public game log: zone changes and life changes. The UI shows the viewer’s projection.

## Documented gaps

- Rooms, WebSockets, and two-client realtime. Local `GameHost` only. Networking remains later.
- Full oracle-text parsing. Most real cards sit in the deck without their written abilities. Hybrid / Phyrexian / `{X}` costs are unpayable. Command Tower–style any-color lands do not produce mana.
- Scryfall bulk JSON is not shipped in git. Cache is filled on demand. A plain browser tab cannot fetch Moxfield (CORS); paste the export instead.
- Face-down cards (morph/manifest). Opponent hand/library identity is hidden; there is no face-down battlefield state.
- Ward, shroud, protection, hexproof on players, and targeting abilities on the stack.
- Full trigger ordering, trigger choices, and leave-the-game triggers.
- Layers, copy effects, timestamps, and dependency. Static P/T is a V1 shortcut, not CR 613.
- Damage replacement, prevention, and multiple replacements interacting.
- Search, modal choices, and a general choice system.
- Combat damage assignment order is the blocker list order; players cannot reorder.
- Keyword counters, keyword-granting effects, and anthem effects other than the static P/T selectors above.
- Stack abilities other than ETB V1, including activated abilities beyond tap-for-mana.
- Commander ninjutsu, partner details beyond stored commander IDs, and dethrone-style combat restrictions.
