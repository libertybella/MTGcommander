import { createId } from "./ids";
import { cloneGameState } from "./clone";
import { isInstantOrSorcery } from "./cardTypes";
import { enterOwnerZone, findCardZone, removeCardFromCurrentZone } from "./zones";
import type { CardInstanceId, GameState, PlayerId, ZoneName } from "./types";

function nextSeatedPlayer(state: GameState, currentId: PlayerId): PlayerId {
  const index = state.players.findIndex((p) => p.id === currentId);
  if (index === -1) {
    throw new Error(`Unknown player ${currentId}`);
  }
  const next = state.players[(index + 1) % state.players.length];
  if (!next) {
    throw new Error("No next player");
  }
  return next.id;
}

export function putSpellOnStack(state: GameState, cardId: CardInstanceId): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const located = findCardZone(state, cardId);
  if (!located || located.zone !== "hand") {
    throw new Error(`Card ${cardId} must be in hand to put on the stack`);
  }

  let next = cloneGameState(state);
  next = removeCardFromCurrentZone(next, cardId);
  const moved = next.cards[cardId];
  if (!moved) {
    throw new Error(`Card ${cardId} missing after leaving hand`);
  }
  moved.zone = "stack";
  next.stack.push({
    id: createId("stack"),
    controllerId: moved.controllerId,
    sourceId: cardId,
    kind: "spell",
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = moved.controllerId;
  return next;
}

export function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    throw new Error("Stack is empty");
  }
  const next = cloneGameState(state);
  const top = next.stack.pop();
  if (!top) {
    throw new Error("Stack is empty");
  }
  next.passesSinceAction = 0;
  next.priorityPlayerId = next.turn.activePlayerId;

  if (!top.sourceId) {
    return next;
  }
  const destination: ZoneName = isInstantOrSorcery(next, top.sourceId)
    ? "graveyard"
    : "battlefield";
  return enterOwnerZone(next, top.sourceId, destination);
}

export function passPriority(state: GameState, playerId: PlayerId): GameState {
  if (playerId !== state.priorityPlayerId) {
    throw new Error("It is not that player's priority");
  }
  let next = cloneGameState(state);
  next.passesSinceAction += 1;
  if (next.passesSinceAction < next.players.length) {
    next.priorityPlayerId = nextSeatedPlayer(next, playerId);
    return next;
  }

  if (next.stack.length > 0) {
    return resolveTopOfStack(next);
  }

  next.passesSinceAction = 0;
  next.priorityPlayerId = next.turn.activePlayerId;
  return next;
}
