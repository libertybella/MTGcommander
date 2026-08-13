# Unsupported Interactions (20-Card Engine)

This log is for the synthetic 20-card pool and the engine as of Checkpoint 21. It is not a complete Comprehensive Rules gap list. See also `RULES_COVERAGE.md`.

Cards in the pool are named `Test …` on purpose. They are not real Magic cards, Scryfall data, or Moxfield imports.

## Represented by the pool

- Five basic lands that tap for one colored mana via `tap_for_mana`.
- A legendary 5/5 flying trample commander.
- Creatures: vanilla, first strike, flying/lifelink, defender, ETB life, and a +1/+1 anthem.
- Instants/sorceries: damage, life gain, opponent life loss, draw, ritual mana, token, destroy creature, mill.

## Not representable in this pool / engine V1

| Interaction | What happens today |
| --- | --- |
| Real-card names, set codes, or oracle text from Scryfall | Not loaded. Only synthetic definitions. |
| Moxfield / text deck import | Not implemented. `startCatalogGame` seats pool IDs only. |
| Activated abilities other than tap-for-mana | No action. Lands with `produces` can tap; other tap abilities are missing. |
| Equipment, auras, planeswalkers | No card types in the pool. |
| Search, shuffle, modal choices | No effects. |
| Ward, shroud, protection | Hexproof exists; the others do not. |
| Counterspells that target a spell on the stack | Targeting is players and creatures only. |
| Mulligans | Opening hands are dealt; no take-backs. |
| Library-out loss | Empty library skips or rejects a draw; it does not lose the game. |
| Triggered abilities other than ETB | Only `enter_battlefield` queues. |
| Replacement effects other than skip-draw | Not in the pool. |
| Layers / copy / face-down | Not implemented. |
| Networking / two clients / rooms | Engine-only. |
| Battlefield UI | Later. |

Manual override for unsupported table talk remains a future product feature, not an engine action.
