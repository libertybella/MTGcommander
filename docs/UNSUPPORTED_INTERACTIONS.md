# Unsupported Interactions (20-Card Engine)

This log is for the synthetic pool, imported real decks, and the local/hosted table as of Checkpoint 36. It is not a complete Comprehensive Rules gap list. See also `RULES_COVERAGE.md`.

Cards in the synthetic pool are named `Test …` on purpose. Real decks load through a Scryfall oracle cache and Moxfield/text import; most oracle text is still not executed.

## Represented by the pool

- Five basic lands that tap for one colored mana via `tap_for_mana`.
- A legendary 5/5 flying trample commander.
- Creatures: vanilla, first strike, flying/lifelink, defender, ETB life, and a +1/+1 anthem.
- Instants/sorceries: damage, life gain, opponent life loss, draw, ritual mana, token, destroy creature, mill, counter target spell.
- Test Oracle: `{T}: Draw a card` as a stacked activated ability.

## Not representable in this pool / engine V1

| Interaction | What happens today |
| --- | --- |
| Real-card names from Scryfall | Loaded on demand into `mtgcommander.oracle.v3`. Known sentence patterns compile (Bolt, Tower, dual taps, simple ETBs, begin-combat amass, Duress-style reveal/choose, Sign in Blood, Negate/Essence Scatter, Go for the Throat, Chart a Course discard, Agonizing Remorse reveal/choose, Expressive Iteration look-and-assign, Channel when the effect clause is known, Class level-up). Unmatched text is a note. |
| Activated abilities other than tap-for-mana | Engine supports definition `activated` (tap and/or mana, stack). Channel compiles as a hand ability (`zone: "hand"`, discard) and resolves as soon as the cost is paid (no pass-around). `{X}` Channel (Boseiju) and Channel clauses the engine cannot compile (Otawara bounce, Takenuma mill-then-return) stay notes. If a permanent has more than one compiled mana or activated ability, the UI asks which to use. Lands use `tap_for_mana`, with a color picker when that ability needs a color. |
| Moxfield / text deck import | Implemented for 2, 3, or 4 players. Electron fetches a public Moxfield URL; a Vite browser tab should paste the export. Empty opponent URLs mirror your deck. |
| Uncompiled permanents | Still sit in the deck. Known keywords, simple mana taps, any-color/`or` taps, `{N}, {T}` draw/damage, untargeted ETBs, and +N/+N anthems work. Until-EOT, modal, search, Phyrexian, and `{X}` do not. |
| Equipment, auras, planeswalkers | No card types in the pool. |
| Search, shuffle, modal choices | No general search. Look-and-assign (hand / library bottom / exile) is compiled; “play the exiled card this turn” is not. |
| Ward, shroud, protection | Hexproof exists; the others do not. |
| Counterspells that target a spell on the stack | Test Counter, Negate (`noncreature_spell`), and Essence Scatter (`creature_spell`) do. Other stack targets (abilities) are not implemented. Unless-pays (Spell Pierce) and mana-value filters (Disdainful Stroke) stay notes. |
| Mulligans | London mulligan before turn 1. Unseated opponents auto-keep. |
| Library-out loss | Implemented: a failed draw from an empty library loses. Mill does not. |
| Triggered abilities other than ETB / begin combat | `enter_battlefield` and `begin_combat` queue. Combined ETB+attack sentences compile the ETB (March from the Black Gate amass). Attack-amass stays a note. |
| Replacement effects other than skip-draw | Not in the pool. |
| Layers / copy / face-down | Not implemented. |
| Networking / two clients / rooms | Electron can host on `ws://<host>:8787` with a room code. Joiners get a redacted view. Unjoined seats still auto-pass. No accounts or public matchmaking. |
| Face-down / morph / manifest | Not implemented. Hidden info is opponent hand and library identity only, except a caster-only hand reveal (`GameState.reveals`). |
| Arena-like polish (animations, zoom, real card frames) | Functional battlefield tiles only. |

Manual override is an engine action (`manual_override`). A seated player can change life, draw, mill, add mana, tap/untap, move a public card, or create a token listed on a card they control. Clicking a battlefield card in Override mode toggles tap/untap. The table sees an override log line. Hidden opponent hand/library cards stay hidden. This is table agreement, not a rules engine for every card.
