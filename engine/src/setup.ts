import { cloneGameState } from "./clone";
import { createCardInstance, createGameState, type CreateGameOptions } from "./createGame";
import { syntheticPoolById } from "./pool";
import { beginMulligan } from "./mulligan";
import { shuffleInPlace } from "./shuffle";
import { moveCard } from "./zones";
import type { CardDefinition, GameState, PlayerId } from "./types";

export type TablePlayerCount = 2 | 3 | 4;

export function defaultPlayerNames(playerCount: TablePlayerCount): string[] {
  if (playerCount === 2) {
    return ["You", "Opponent"];
  }
  return Array.from({ length: playerCount }, (_, index) =>
    index === 0 ? "You" : `Opponent ${index}`,
  );
}

export type CatalogDeckSpec = {
  commanderDefinitionId?: string;
  commanderDefinitionIds?: string[];
  /** Index 0 is the top of the library after seating, before opening hands. */
  libraryDefinitionIds: string[];
};

export type StartCatalogGameOptions = CreateGameOptions & {
  decks: CatalogDeckSpec[];
  openingHandSize?: number;
  /** Seating aid for short complete-game tests. Defaults to 40. */
  startingLife?: number;
  /** Engine tests skip opening mulligans. The client leaves this false. */
  skipMulligan?: boolean;
};

export type StartDefinitionGameOptions = StartCatalogGameOptions & {
  definitions: Record<string, CardDefinition>;
  shuffle?: boolean;
  random?: () => number;
};

function requirePlayer(state: GameState, playerId: PlayerId) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  return player;
}

function commanderIdsFromSpec(spec: CatalogDeckSpec): string[] {
  if (spec.commanderDefinitionIds && spec.commanderDefinitionIds.length > 0) {
    return spec.commanderDefinitionIds;
  }
  if (spec.commanderDefinitionId) {
    return [spec.commanderDefinitionId];
  }
  throw new Error("Each deck needs a commander");
}

function requireDefinition(
  definitions: Record<string, CardDefinition>,
  definitionId: string,
): CardDefinition {
  const definition = definitions[definitionId];
  if (!definition) {
    throw new Error(`Unknown definition ${definitionId}`);
  }
  return definition;
}

export function seatDecks(
  state: GameState,
  decks: CatalogDeckSpec[],
  definitions: Record<string, CardDefinition>,
  options: { shuffle?: boolean; random?: () => number } = {},
): GameState {
  if (decks.length !== state.players.length) {
    throw new Error("Each player needs a deck");
  }
  const next = cloneGameState(state);
  for (let index = 0; index < decks.length; index += 1) {
    const spec = decks[index];
    const player = next.players[index];
    if (!spec || !player) {
      throw new Error("Missing deck or player");
    }
    for (const commanderDefinitionId of commanderIdsFromSpec(spec)) {
      const commanderDef = requireDefinition(definitions, commanderDefinitionId);
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
    }

    for (const definitionId of spec.libraryDefinitionIds) {
      const definition = requireDefinition(definitions, definitionId);
      next.definitions[definition.id] = definition;
      const card = createCardInstance({
        definitionId: definition.id,
        ownerId: player.id,
        zone: "library",
      });
      next.cards[card.id] = card;
      requirePlayer(next, player.id).zones.library.push(card.id);
    }

    if (options.shuffle) {
      shuffleInPlace(requirePlayer(next, player.id).zones.library, options.random);
    }
  }
  return next;
}

/**
 * Seat synthetic-pool decks: commander in the command zone, remaining cards
 * in library order. Does not shuffle.
 */
export function seatCatalogDecks(state: GameState, decks: CatalogDeckSpec[]): GameState {
  return seatDecks(state, decks, syntheticPoolById());
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

function applyStartingLife(state: GameState, startingLife: number | undefined): GameState {
  if (startingLife === undefined) {
    return state;
  }
  const next = cloneGameState(state);
  for (const player of next.players) {
    player.life = startingLife;
  }
  return next;
}

function finishStart(state: GameState, openingHandSize: number, startingLife: number | undefined, skipMulligan: boolean): GameState {
  const dealt = applyStartingLife(dealOpeningHands(state, openingHandSize), startingLife);
  if (skipMulligan) {
    return dealt;
  }
  return beginMulligan(dealt, openingHandSize);
}

export function startCatalogGame(options: StartCatalogGameOptions): GameState {
  const { decks, openingHandSize = 7, startingLife, skipMulligan = true, ...createOptions } = options;
  const seated = seatCatalogDecks(createGameState(createOptions), decks);
  return finishStart(seated, openingHandSize, startingLife, skipMulligan);
}

export function startDefinitionGame(options: StartDefinitionGameOptions): GameState {
  const {
    decks,
    definitions,
    openingHandSize = 7,
    startingLife,
    shuffle = true,
    random,
    skipMulligan = true,
    ...createOptions
  } = options;
  const seated = seatDecks(createGameState(createOptions), decks, definitions, {
    shuffle,
    random,
  });
  return finishStart(seated, openingHandSize, startingLife, skipMulligan);
}
