import { COMMANDER_DAMAGE_TO_LOSE } from "./cardTypes";
import { isLiving, livingPlayerCount, nextLivingPlayerId, winnerId } from "./players";
import type { GameState } from "./types";

/**
 * Apply current loss conditions in place: 0 life, 21 commander damage, and
 * derived winner. Does not skip turns.
 */
export function applyStateBasedActionsInPlace(state: GameState): void {
  for (const player of state.players) {
    if (player.lost) {
      continue;
    }
    if (player.life <= 0) {
      player.lost = true;
      continue;
    }
    for (const amount of Object.values(player.commander.damageReceived)) {
      if (amount >= COMMANDER_DAMAGE_TO_LOSE) {
        player.lost = true;
        break;
      }
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
