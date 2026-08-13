import { isCreature } from "./cardTypes";
import { COMMANDER_DAMAGE_TO_LOSE } from "./cardTypes";
import { creatureToughness } from "./derived";
import { eliminatePlayerInPlace } from "./elimination";
import { isLiving, livingPlayerCount, nextLivingPlayerId, winnerId } from "./players";
import { moveCardInPlace } from "./zones";
import type { GameState } from "./types";

function shouldLose(player: GameState["players"][number]): boolean {
  if (player.life <= 0) {
    return true;
  }
  return Object.values(player.commander.damageReceived).some(
    (amount) => amount >= COMMANDER_DAMAGE_TO_LOSE,
  );
}

function destroyZeroToughnessInPlace(state: GameState): boolean {
  let changed = false;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || !isCreature(state, card.id)) {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    if (definition?.toughness === null || definition?.toughness === undefined) {
      continue;
    }
    if (creatureToughness(state, card.id) > 0) {
      continue;
    }
    moveCardInPlace(state, card.id, "graveyard");
    changed = true;
  }
  return changed;
}

/**
 * Apply current loss conditions: 0 life and 21 commander damage use the same
 * leave-the-game transition as concede. Creatures with 0 toughness also die
 * (including indestructible). Does not skip turns.
 */
export function applyStateBasedActionsInPlace(state: GameState): void {
  let changed = true;
  while (changed) {
    changed = false;
    const leaving = state.players
      .filter((player) => !player.lost && shouldLose(player))
      .map((player) => player.id);
    for (const playerId of leaving) {
      eliminatePlayerInPlace(state, playerId);
      changed = true;
    }
    if (destroyZeroToughnessInPlace(state)) {
      changed = true;
    }
  }
  state.winnerId = winnerId(state);
}

export function isGameOver(state: GameState): boolean {
  return livingPlayerCount(state) <= 1;
}

/** If the priority player has lost, give priority to a living player. */
export function redirectPriorityIfLost(state: GameState): void {
  if (livingPlayerCount(state) === 0) {
    return;
  }
  if (isLiving(state, state.priorityPlayerId)) {
    return;
  }
  state.priorityPlayerId = isLiving(state, state.turn.activePlayerId)
    ? state.turn.activePlayerId
    : nextLivingPlayerId(state, state.priorityPlayerId);
  state.passesSinceAction = 0;
}
