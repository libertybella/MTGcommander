import { cloneGameState } from "./clone";
import { createCardInstance, createGameState, type CreateGameOptions } from "./createGame";
import { syntheticPoolById } from "./pool";
import { moveCard } from "./zones";
import type { GameState, PlayerId } from "./types";

export type CatalogDeckSpec = {
  commanderDefinitionId: string;
  /** Index 0 is the top of the library after seating, before opening hands. */
  libraryDefinitionIds: string[];
};

export type StartCatalogGameOptions = CreateGameOptions & {
  decks: CatalogDeckSpec[];
  openingHandSize?: number;
  /** Seating aid for short complete-game tests. Defaults to 40. */
  startingLife?: number;
};

function requirePlayer(state: GameState, playerId: PlayerId) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  return player;
}

/**
 * Seat synthetic-pool decks: commander in the command zone, remaining cards
 * in library order. Does not shuffle. Not a real-card or Moxfield importer.
 */
export function seatCatalogDecks(state: GameState, decks: CatalogDeckSpec[]): GameState {
  if (decks.length !== state.players.length) {
    throw new Error("Each player needs a deck");
  }
  const pool = syntheticPoolById();
  const next = cloneGameState(state);
  for (let index = 0; index < decks.length; index += 1) {
    const spec = decks[index];
    const player = next.players[index];
    if (!spec || !player) {
      throw new Error("Missing deck or player");
    }
    const commanderDef = pool[spec.commanderDefinitionId];
    if (!commanderDef) {
      throw new Error(`Unknown pool definition ${spec.commanderDefinitionId}`);
    }
    next.definitions[commanderDef.id] = commanderDef;
    const commander = createCardInstance({
      definitionId: commanderDef.id,
      ownerId: player.id,
      zone: "command",
    });
    const seatedPlayer = requirePlayer(next, player.id);
    next.cards[commander.id] = commander;
    seatedPlayer.zones.command.push(commander.id);
    seatedPlayer.commander.commanderIds.push(commander.id);

    for (const definitionId of spec.libraryDefinitionIds) {
      const definition = pool[definitionId];
      if (!definition) {
        throw new Error(`Unknown pool definition ${definitionId}`);
      }
      next.definitions[definition.id] = definition;
      const card = createCardInstance({
        definitionId: definition.id,
        ownerId: player.id,
        zone: "library",
      });
      next.cards[card.id] = card;
      requirePlayer(next, player.id).zones.library.push(card.id);
    }
  }
  return next;
}

export function dealOpeningHands(state: GameState, count = 7): GameState {
  let next = state;
  for (const player of state.players) {
    for (let i = 0; i < count; i += 1) {
      const current = requirePlayer(next, player.id);
      const top = current.zones.library[0];
      if (!top) {
        break;
      }
      next = moveCard(next, top, "hand");
    }
  }
  return next;
}

export function startCatalogGame(options: StartCatalogGameOptions): GameState {
  const { decks, openingHandSize = 7, startingLife, ...createOptions } = options;
  const seated = seatCatalogDecks(createGameState(createOptions), decks);
  const dealt = dealOpeningHands(seated, openingHandSize);
  if (startingLife === undefined) {
    return dealt;
  }
  const next = cloneGameState(dealt);
  for (const player of next.players) {
    player.life = startingLife;
  }
  return next;
}
