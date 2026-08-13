# Rules Coverage (Engine V1 through Checkpoint 20)

This document records what the engine implements and what it intentionally does not. It is not a complete CR translation.

## Implemented

- 2–4 player Commander game state, turns, priority, and a last-in first-out stack.
- Zone movement with owner-zone integrity, including a `removed` zone for players who have left the game.
- Casting spells from hand, playing one land per turn, combat declarations, concede.
- Choose-on-cast targeting; legality at cast and again on resolve. If no legal targets remain, the spell’s effects are skipped (fizzle) and the card still goes to its destination.
- Hidden information projection: opponent hands and libraries hide card identity; battlefield, graveyard, exile, command, stack, life, and commander damage stay public.
- Basic effects: damage, life, draw, mill (mill what’s there), discard (front of hand), sacrifice, counters, tokens, tap/untap, mana, zone moves.
- `tap_for_mana` for permanents whose definition has `produces`.
- A 20-card synthetic pool and catalog seating (`startCatalogGame`). Not real Magic cards.
- Keywords: flying, reach, haste, vigilance, trample, deathtouch, lifelink, first strike, double strike, menace, hexproof, indestructible, flash, defender.
- Derived power/toughness: printed values, `p1p1` counters, and simple static P/T modifiers (`self` or `controlled_creatures`).
- Enter-the-battlefield triggers become stack abilities. No target choices and no AP-order for simultaneous triggers.
- Draw replacement: a controlled `replace_draw` / `skip` permanent skips draws.
- State-based actions: 0 life, 21 commander damage, and 0 toughness (0 toughness dies even if indestructible). Lethal damage destruction still runs after combat damage.

## Documented gaps

- Rooms, WebSockets, and two-client realtime. Engine-only. Networking remains later.
- Battlefield UI, deck import, Scryfall, Moxfield, real-card database. Synthetic cards only.
- Ward, shroud, protection, hexproof on players, targeting spells on the stack.
- Full trigger ordering, trigger choices, and leave-the-game triggers.
- Layers, copy effects, timestamps, and dependency. Static P/T is a V1 shortcut, not CR 613.
- Damage replacement, prevention, and multiple replacements interacting.
- Search, modal choices, and a general choice system.
- Empty-library loss is not implemented. Drawing from an empty library is skipped or rejected depending on path; it does not lose the game.
- Combat damage assignment order is the blocker list order; players cannot reorder.
- Keyword counters, keyword-granting effects, and anthem effects other than the static P/T selectors above.
- Stack abilities other than ETB V1, including activated abilities beyond tap-for-mana.
- Commander ninjutsu, partner details beyond stored commander IDs, and dethrone-style combat restrictions.
