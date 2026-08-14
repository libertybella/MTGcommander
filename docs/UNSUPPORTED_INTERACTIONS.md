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
| Real-card names from Scryfall | Loaded on demand into `mtgcommander.oracle.v1`. Known sentence patterns compile (Bolt, Tower, dual taps, simple ETBs). Unmatched text is a note. |
| Moxfield / text deck import | Implemented for 2, 3, or 4 players. Electron fetches a public Moxfield URL; a Vite browser tab should paste the export. Empty opponent URLs mirror your deck. |
| Uncompiled permanents | Still sit in the deck. Known keywords, simple mana taps, any-color/`or` taps, `{N}, {T}` draw/damage, untargeted ETBs, and +N/+N anthems work. Until-EOT, modal, search, Phyrexian, and `{X}` do not. |
| Activated abilities other than tap-for-mana | Engine supports definition `activated` (tap and/or mana, stack). UI activates index 0. Lands use `tap_for_mana`, with a color picker when needed. |
| Equipment, auras, planeswalkers | No card types in the pool. |
| Search, shuffle, modal choices | No effects. |
| Ward, shroud, protection | Hexproof exists; the others do not. |
| Counterspells that target a spell on the stack | Test Counter does. Other stack targets (abilities) are not implemented. |
| Mulligans | London mulligan before turn 1. Unseated opponents auto-keep. |
| Library-out loss | Implemented: a failed draw from an empty library loses. Mill does not. |
| Triggered abilities other than ETB | Only `enter_battlefield` queues. |
| Replacement effects other than skip-draw | Not in the pool. |
| Layers / copy / face-down | Not implemented. |
| Networking / two clients / rooms | Electron can host on `ws://<host>:8787` with a room code. Joiners get a redacted view. Unjoined seats still auto-pass. No accounts or public matchmaking. |
| Face-down / morph / manifest | Not implemented. Hidden info is opponent hand and library identity only. |
| Arena-like polish (animations, zoom, real card frames) | Functional battlefield tiles only. |

Manual override is an engine action (`manual_override`). A seated player can change life, draw, mill, add mana, tap/untap, or move a public card. The table sees an override log line. Hidden opponent hand/library cards stay hidden. This is table agreement, not a rules engine for every card.
