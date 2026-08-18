import { cloneGameState } from "./clone";
import { D20_SIDES, rollDieResult } from "./dice";
import { beginMulligan, DEFAULT_STARTING_HAND_SIZE } from "./mulligan";
import { isLiving, livingPlayers, requireLiving } from "./players";
import type { GameState, PlayerId } from "./types";

export function isOpeningRoll(state: GameState): boolean {
  return state.openingRoll !== null;
}

export function beginOpeningRoll(
  state: GameState,
  startingHandSize = DEFAULT_STARTING_HAND_SIZE,
): GameState {
  const next = cloneGameState(state);
  next.openingRoll = { rolls: {}, startingHandSize };
  next.mulligan = null;
  return next;
}

function resolveOpeningRoll(state: GameState): GameState {
  if (!state.openingRoll) {
    return state;
  }
  const living = livingPlayers(state);
  if (living.some((player) => state.openingRoll?.rolls[player.id] === undefined)) {
    return state;
  }
  const scored = living.map((player) => ({
    id: player.id,
    result: state.openingRoll?.rolls[player.id] ?? 0,
  }));
  const high = Math.max(...scored.map((entry) => entry.result));
  const tied = scored.filter((entry) => entry.result === high);
  if (tied.length > 1) {
    const next = cloneGameState(state);
    if (!next.openingRoll) {
      return next;
    }
    for (const entry of tied) {
      delete next.openingRoll.rolls[entry.id];
    }
    next.log.push({ kind: "opening_tie", playerIds: tied.map((entry) => entry.id) });
    return next;
  }
  const winnerId = tied[0]?.id;
  if (!winnerId) {
    return state;
  }
  const next = cloneGameState(state);
  const handSize = next.openingRoll?.startingHandSize ?? DEFAULT_STARTING_HAND_SIZE;
  next.openingRoll = null;
  next.turn.activePlayerId = winnerId;
  next.priorityPlayerId = winnerId;
  next.firstPlayerId = winnerId;
  next.log.push({ kind: "first_player", playerId: winnerId });
  return beginMulligan(next, handSize);
}

/**
 * Official first-player d20. Each living player rolls once; the highest starts.
 * Ties among the leaders roll again.
 */
export function applyOpeningRoll(
  state: GameState,
  playerId: PlayerId,
  random: () => number = Math.random,
): GameState {
  requireLiving(state, playerId);
  if (!state.openingRoll) {
    throw new Error("First-player rolls are finished");
  }
  if (!isLiving(state, playerId)) {
    throw new Error("That player has already lost");
  }
  if (state.openingRoll.rolls[playerId] !== undefined) {
    throw new Error("You already rolled for first player");
  }
  const result = rollDieResult(D20_SIDES, random);
  const next = cloneGameState(state);
  if (!next.openingRoll) {
    throw new Error("First-player rolls are finished");
  }
  next.openingRoll.rolls[playerId] = result;
  next.log.push({
    kind: "die_roll",
    playerId,
    sides: D20_SIDES,
    result,
  });
  return resolveOpeningRoll(next);
}

export function openingRollPending(state: GameState, playerId: PlayerId): boolean {
  return Boolean(state.openingRoll && state.openingRoll.rolls[playerId] === undefined);
}
