import { createCardDefinition, createCardInstance } from "./createGame";
import type { GameState } from "./types";

/** Seed libraries so turn walks do not lose to empty-library draws. Tests only. */
export function fillLibraries(game: GameState, cardsPerPlayer = 16): void {
  const definition = createCardDefinition({
    name: "Test Library Filler",
    typeLine: "Instant",
  });
  game.definitions[definition.id] = definition;
  for (const player of game.players) {
    for (let i = 0; i < cardsPerPlayer; i += 1) {
      const card = createCardInstance({
        definitionId: definition.id,
        ownerId: player.id,
        zone: "library",
      });
      game.cards[card.id] = card;
      player.zones.library.push(card.id);
    }
  }
}
