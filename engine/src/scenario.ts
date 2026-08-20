import { createCardDefinition, createCardInstance, createGameState } from "./createGame";
import type {
  CardDefinition,
  CardInstanceId,
  GameState,
  PlayerId,
  PlayerZones,
} from "./types";

/**
 * Test scenario builder. Not part of the public engine API — imported by
 * test files to cut the ceremony of seating hand-built states.
 *
 * Convention: tag tests with the CR rule they witness in the test name,
 * e.g. `it("[CR 702.19] trample assigns excess damage to the player")`.
 */
export type Scenario = {
  game: GameState;
  players: PlayerId[];
  /** Add a definition + instance to a player's zone; returns the instance id. */
  add: (
    definition: CardDefinition,
    ownerId: PlayerId,
    zone: keyof PlayerZones,
    options?: { tapped?: boolean; summoningSick?: boolean; commander?: boolean },
  ) => CardInstanceId;
  /** Put the game in the given player's precombat main phase with priority. */
  mainPhase: (playerId: PlayerId) => void;
};

export function scenario(options: { players?: 2 | 3 | 4 } = {}): Scenario {
  const game = createGameState({ playerCount: options.players ?? 2 });
  const players = game.players.map((player) => player.id);

  return {
    game,
    players,
    add(definition, ownerId, zone, opts = {}) {
      game.definitions[definition.id] = definition;
      const card = createCardInstance({
        definitionId: definition.id,
        ownerId,
        zone: zone === "removed" ? "removed" : zone,
        summoningSick: opts.summoningSick ?? false,
      });
      card.tapped = opts.tapped ?? false;
      game.cards[card.id] = card;
      const player = game.players.find((entry) => entry.id === ownerId);
      if (!player) {
        throw new Error(`Unknown player ${ownerId}`);
      }
      player.zones[zone].push(card.id);
      if (opts.commander) {
        player.commander.commanderIds.push(card.id);
      }
      return card.id;
    },
    mainPhase(playerId) {
      game.turn.activePlayerId = playerId;
      game.turn.phase = "precombatMain";
      game.turn.step = "precombatMain";
      game.priorityPlayerId = playerId;
      game.passesSinceAction = 0;
    },
  };
}

/** Common test definitions, name-spaced under "Test" like the synthetic pool. */
export const testCards = {
  island: () =>
    createCardDefinition({ name: "Test Island", typeLine: "Basic Land — Island", produces: { U: 1 } }),
  forest: () =>
    createCardDefinition({ name: "Test Forest", typeLine: "Basic Land — Forest", produces: { G: 1 } }),
  bear: () =>
    createCardDefinition({ name: "Test Bear", typeLine: "Creature — Bear", power: 2, toughness: 2 }),
  instant: (manaCost = "{U}") =>
    createCardDefinition({ name: "Test Instant", typeLine: "Instant", manaCost }),
};
