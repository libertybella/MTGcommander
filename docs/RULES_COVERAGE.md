# Rules Coverage (Engine V1 through Checkpoint 36)

This document records what the engine implements and what it intentionally does not. It is not a complete CR translation.

## Implemented

- 2–4 player Commander game state, turns, priority, and a last-in first-out stack.
- Zone movement with owner-zone integrity, including a `removed` zone for players who have left the game.
- Casting spells from hand, playing one land per turn, combat declarations, concede.
- Choose-on-cast targeting; legality at cast and again on resolve. If no legal targets remain, the spell’s effects are skipped (fizzle) and the card still goes to its destination. Targets may be players, creatures, or spells on the stack.
- Hidden information projection: opponent hands and libraries hide card identity; battlefield, graveyard, exile, command, stack, life, and commander damage stay public. The UI shows `GameHost.viewFor`, not raw authority.
- Basic effects: damage, life, draw, mill (mill what’s there), discard (front of hand), sacrifice, counters, tokens, tap/untap, mana, zone moves.
- `tap_for_mana` for permanents whose definition has `produces`, `producesOptions`, or `producesAnyColor`. Mana abilities do not use the stack. Dual lands and Command Tower ask for a color.
- Non-mana activated abilities: `activate_ability` pays `{T}` and/or a simple mana cost, then puts an ability on the stack. Creatures with a tap cost respect summoning sickness. Targets are chosen on activate and rechecked on resolve.
- A 22-card synthetic pool and catalog seating (`startCatalogGame`). Still available from the start screen.
- Real cards: Scryfall-shaped `OracleCard` data compiles into `CardDefinition` by matching known oracle sentences. Instant/sorcery patterns include damage, life, draw, mill, destroy/exile/bounce, counter, ritual mana, and simple tokens. Creatures get printed P/T, known keywords, untargeted `When ~ enters` triggers, and `Creatures you control get +N/+N`. Lands/artifacts tap via `{T}: Add {M}`, `{T}: Add {G} or {U}`, or `{T}: Add one mana of any color`. `{N}, {T}:` abilities using those effects compile. Leftover sentences are notes.
- Deck import: Moxfield public URL (Electron IPC) or pasted Commander/Arena text. `startDefinitionGame` shuffles and seats 2, 3, or 4 players. Empty opponent URLs mirror your deck. Compile notes are shown; uncompiled cards stay in the deck.
- Local React battlefield for 2, 3, or 4 players. Actions go through `GameHost.submit`. Optional local hotseat seats every player at this PC; otherwise unseated opponents auto-pass. Authority persists in localStorage for local tables. Oracle cache key `mtgcommander.oracle.v1`.
- London mulligan before the first turn: keep or shuffle-and-draw-7, then put counted cards on the bottom. In 3–4 player games the first mulligan is free (CR 103.5c).
- Optional WebSocket table: Electron hosts on port 8787 with a room code. Friends join with a display name and receive `viewFor` themselves. Unjoined seats still auto-pass.
- Keywords: flying, reach, haste, vigilance, trample, deathtouch, lifelink, first strike, double strike, menace, hexproof, indestructible, flash, defender.
- Derived power/toughness: printed values, `p1p1` counters, and simple static P/T modifiers (`self` or `controlled_creatures`).
- Enter-the-battlefield triggers become stack abilities. No target choices and no AP-order for simultaneous triggers.
- Draw replacement: a controlled `replace_draw` / `skip` permanent skips draws.
- State-based actions: 0 life, 21 commander damage, 0 toughness (0 toughness dies even if indestructible), and failing to draw from an empty library. Lethal damage destruction still runs after combat damage.
- Stack targeting: spells on the stack can be chosen (`kind: "spell"`). Test Counter counters a targeted spell; the countered card goes to the graveyard (commanders still return to the command zone).
- Public game log: zone changes, life changes, and table overrides. The UI shows the viewer’s projection.
- Manual override: a seated living player may adjust life, draw, mill, add one mana, tap/untap, or move a public card without priority. Hidden opponent hand/library cards cannot be moved. Blocked during mulligan and after game over.

## Documented gaps

- Rooms exist as one in-memory table per Electron host. No matchmaking, no accounts, no cloud hosting. Friends need the host IP (LAN or Tailscale) and room code.
- Full oracle-text parsing. Unmatched sentences stay as notes. Hybrid pips `{R/W}` are payable. Phyrexian and `{X}` costs are unpayable. Command Tower–style lands tap for any color; commander identity is not enforced.
- Scryfall bulk JSON is not shipped in git. Cache is filled on demand. A plain browser tab cannot fetch Moxfield (CORS); paste the export instead.
- Face-down cards (morph/manifest). Opponent hand/library identity is hidden; there is no face-down battlefield state.
- Ward, shroud, protection, hexproof on players, and targeting abilities on the stack.
- Full trigger ordering, trigger choices, and leave-the-game triggers.
- Layers, copy effects, timestamps, and dependency. Static P/T is a V1 shortcut, not CR 613.
- Damage replacement, prevention, and multiple replacements interacting.
- Search, modal choices, and a general choice system.
- Combat damage assignment order is the blocker list order; players cannot reorder.
- Keyword counters, keyword-granting effects, and anthem effects other than the static P/T selectors above.
- Other trigger events, loyalty abilities, until-end-of-turn pumps, modal spells, search, and oracle compile of Phyrexian/`{X}`. Activated abilities cannot yet be targeted by counterspells. Use table override until those compile.
- Commander ninjutsu, partner details beyond stored commander IDs, and dethrone-style combat restrictions.
