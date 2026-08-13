import { COMMANDER_DAMAGE_TO_LOSE } from "./cardTypes";
import { eliminatePlayerInPlace } from "./elimination";
import { isLiving, livingPlayerCount, nextLivingPlayerId, winnerId } from "./players";
import type { GameState } from "./types";

function shouldLose(player: GameState["players"][number]): boolean {
  if (player.life <= 0) {
    return true;
  }
  return Object.values(player.commander.damageReceived).some(
    (amount) => amount >= COMMANDER_DAMAGE_TO_LOSE,
  );
}

/**
 * Apply current loss conditions: 0 life and 21 commander damage use the same
 * leave-the-game transition as concede. Does not skip turns.
 */
export function applyStateBasedActionsInPlace(state: GameState): void {
  const leaving = state.players
    .filter((player) => !player.lost && shouldLose(player))
    .map((player) => player.id);
  for (const playerId of leaving) {
    eliminatePlayerInPlace(state, playerId);
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
