import { cloneGameState } from "./clone";
import { isLiving, livingPlayerCount } from "./players";
import { shuffleInPlace } from "./shuffle";
import { isGameOver } from "./status";
import { advanceStep } from "./turn";
import { moveCard, moveCardInPlace } from "./zones";
import type { CardInstanceId, GameState, MulliganState, PlayerId } from "./types";

export const DEFAULT_STARTING_HAND_SIZE = 7;

export function isMulliganOpen(state: GameState): boolean {
  return state.mulligan !== null;
}

export function freeMulliganCount(playerCount: number): number {
  return playerCount >= 3 ? 1 : 0;
}

export function countedMulligans(state: GameState, playerId: PlayerId): number {
  const taken = state.mulligan?.taken[playerId] ?? 0;
  return Math.max(0, taken - freeMulliganCount(state.players.length));
}

export function beginMulligan(state: GameState, startingHandSize = DEFAULT_STARTING_HAND_SIZE): GameState {
  const next = cloneGameState(state);
  const first =
    next.players.find((player) => player.id === next.turn.activePlayerId && isLiving(next, player.id)) ??
    next.players.find((player) => isLiving(next, player.id));
  if (!first) {
    throw new Error("No living player to begin mulligans");
  }
  const taken: Record<PlayerId, number> = {};
  const kept: Record<PlayerId, boolean> = {};
  for (const player of next.players) {
    taken[player.id] = 0;
    kept[player.id] = !isLiving(next, player.id);
  }
  next.mulligan = {
    decidingPlayerId: first.id,
    taken,
    kept,
    pendingBottom: 0,
    startingHandSize,
  };
  return next;
}

function requireMulligan(state: GameState): MulliganState {
  if (!state.mulligan) {
    throw new Error("Mulligans are finished");
  }
  return state.mulligan;
}

function requireDecider(state: GameState, playerId: PlayerId): MulliganState {
  const mulligan = requireMulligan(state);
  if (!isLiving(state, playerId)) {
    throw new Error("That player has already lost");
  }
  if (mulligan.decidingPlayerId !== playerId) {
    throw new Error("It is not that player's mulligan");
  }
  if (mulligan.kept[playerId]) {
    throw new Error("That player already kept");
  }
  return mulligan;
}

function requirePlayer(state: GameState, playerId: PlayerId) {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  return player;
}

function skipFirstTurnUntap(state: GameState): GameState {
  if (state.turn.number === 1 && state.turn.step === "untap") {
    return advanceStep(state);
  }
  return state;
}

function advanceDeciderInPlace(state: GameState): void {
  if (!state.mulligan) {
    return;
  }
  if (isGameOver(state) || livingPlayerCount(state) <= 1) {
    state.mulligan = null;
    return;
  }
  const currentId = state.mulligan.decidingPlayerId;
  const startIndex = Math.max(
    0,
    state.players.findIndex((player) => player.id === currentId),
  );
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const player = state.players[(startIndex + offset) % state.players.length];
    if (player && isLiving(state, player.id) && !state.mulligan.kept[player.id]) {
      state.mulligan.decidingPlayerId = player.id;
      state.mulligan.pendingBottom = 0;
      return;
    }
  }
  state.mulligan = null;
}

export function reconcileMulliganAfterLoss(state: GameState): GameState {
  if (!state.mulligan) {
    return state;
  }
  const next = cloneGameState(state);
  if (!next.mulligan) {
    return next;
  }
  for (const player of next.players) {
    if (!isLiving(next, player.id)) {
      next.mulligan.kept[player.id] = true;
    }
  }
  if (!isLiving(next, next.mulligan.decidingPlayerId) || next.mulligan.kept[next.mulligan.decidingPlayerId]) {
    advanceDeciderInPlace(next);
  }
  return next;
}

export function applyKeepHand(state: GameState, playerId: PlayerId): GameState {
  requireDecider(state, playerId);
  if (state.mulligan && state.mulligan.pendingBottom > 0) {
    throw new Error("Put cards on the bottom before keeping");
  }
  const next = cloneGameState(state);
  if (!next.mulligan) {
    throw new Error("Mulligans are finished");
  }
  next.mulligan.kept[playerId] = true;
  advanceDeciderInPlace(next);
  if (!next.mulligan) {
    deployLeylinesInPlace(next);
    return skipFirstTurnUntap(next);
  }
  return next;
}

/**
 * Leylines: opening-hand copies begin the game on the battlefield once every
 * player has kept. The "may" is auto-taken — a documented approximation.
 */
function deployLeylinesInPlace(state: GameState): void {
  for (const player of state.players) {
    const leylines = player.zones.hand.filter(
      (cardId) =>
        state.definitions[state.cards[cardId]?.definitionId ?? ""]?.leyline === true,
    );
    for (const cardId of leylines) {
      moveCardInPlace(state, cardId, "battlefield");
    }
  }
}

export function applyTakeMulligan(
  state: GameState,
  playerId: PlayerId,
  random: () => number = Math.random,
): GameState {
  const mulligan = requireDecider(state, playerId);
  if (mulligan.pendingBottom > 0) {
    throw new Error("Put cards on the bottom before taking another mulligan");
  }
  const takenAfter = (mulligan.taken[playerId] ?? 0) + 1;
  const countedAfter = Math.max(0, takenAfter - freeMulliganCount(state.players.length));
  if (countedAfter > mulligan.startingHandSize) {
    throw new Error("Cannot mulligan below zero cards");
  }

  let next = cloneGameState(state);
  if (!next.mulligan) {
    throw new Error("Mulligans are finished");
  }
  const startingHandSize = next.mulligan.startingHandSize;
  const player = requirePlayer(next, playerId);
  const hand = [...player.zones.hand];
  for (const cardId of hand) {
    next = moveCard(next, cardId, "library", { libraryPosition: "bottom" });
  }
  const library = requirePlayer(next, playerId).zones.library;
  shuffleInPlace(library, random);
  const drawCount = Math.min(startingHandSize, library.length);
  for (let index = 0; index < drawCount; index += 1) {
    const top = requirePlayer(next, playerId).zones.library[0];
    if (!top) {
      break;
    }
    next = moveCard(next, top, "hand");
  }
  if (!next.mulligan) {
    throw new Error("Mulligans are finished");
  }
  next.mulligan.taken[playerId] = takenAfter;
  next.mulligan.pendingBottom = Math.min(
    countedAfter,
    requirePlayer(next, playerId).zones.hand.length,
  );
  return next;
}

export function applyBottomCards(
  state: GameState,
  playerId: PlayerId,
  cardIds: CardInstanceId[],
): GameState {
  const mulligan = requireDecider(state, playerId);
  if (cardIds.length !== mulligan.pendingBottom) {
    throw new Error(`Put exactly ${mulligan.pendingBottom} card(s) on the bottom`);
  }
  const unique = new Set(cardIds);
  if (unique.size !== cardIds.length) {
    throw new Error("Cannot bottom the same card twice");
  }
  const player = requirePlayer(state, playerId);
  for (const cardId of cardIds) {
    if (!player.zones.hand.includes(cardId)) {
      throw new Error("Bottom cards must be in hand");
    }
  }
  let next = cloneGameState(state);
  for (const cardId of cardIds) {
    next = moveCard(next, cardId, "library", { libraryPosition: "bottom" });
  }
  if (!next.mulligan) {
    throw new Error("Mulligans are finished");
  }
  next.mulligan.pendingBottom = 0;
  return next;
}
