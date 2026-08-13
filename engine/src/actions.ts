import { declareAttackers, declareBlockers, pendingBlockerPlayer, priorityForStep } from "./combat";
import { isInstant, isInstantOrSorcery, isLand, isMainPhase } from "./cardTypes";
import { canPayManaCost, payManaCost } from "./mana";
import { passPriority, putSpellOnStack } from "./stack";
import { advanceStep } from "./turn";
import { findCardZone } from "./zones";
import type { CardInstanceId, GameAction, GameState, PlayerId } from "./types";

function requirePlayer(state: GameState, playerId: PlayerId): void {
  if (!state.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player ${playerId}`);
  }
}

function requirePriority(state: GameState, playerId: PlayerId): void {
  requirePlayer(state, playerId);
  if (playerId !== state.priorityPlayerId) {
    throw new Error("It is not that player's priority");
  }
}

function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

function assertUnchanged(before: string, state: GameState, label: string): void {
  if (JSON.stringify(state) !== before) {
    throw new Error(`${label} mutated GameState`);
  }
}

function canCastNonInstantNow(state: GameState, playerId: PlayerId): boolean {
  return (
    playerId === state.turn.activePlayerId &&
    isMainPhase(state) &&
    state.stack.length === 0
  );
}

function validateCast(state: GameState, playerId: PlayerId, cardId: CardInstanceId): string {
  requirePriority(state, playerId);

  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const definition = state.definitions[card.definitionId];
  if (!definition) {
    throw new Error(`Unknown card definition for ${cardId}`);
  }

  const located = findCardZone(state, cardId);
  if (!located || located.zone !== "hand" || located.playerId !== playerId) {
    throw new Error(`Card ${cardId} must be in the player's hand`);
  }

  if (isLand(state, cardId) && !isInstantOrSorcery(state, cardId)) {
    throw new Error(`Card ${cardId} is a land and cannot be cast as a spell`);
  }

  if (!isInstant(state, cardId) && !canCastNonInstantNow(state, playerId)) {
    throw new Error("That spell cannot be cast at this time");
  }

  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (!canPayManaCost(player.mana, definition.manaCost)) {
    throw new Error("Cannot pay mana cost");
  }

  return definition.manaCost;
}

function applyCastSpell(state: GameState, playerId: PlayerId, cardId: CardInstanceId): GameState {
  const cost = validateCast(state, playerId, cardId);
  const paid = payManaCost(state, playerId, cost);
  return putSpellOnStack(paid, cardId);
}

function applyPassPriority(state: GameState, playerId: PlayerId): GameState {
  requirePriority(state, playerId);
  if (
    state.turn.step === "declareBlockers" &&
    pendingBlockerPlayer(state) === playerId
  ) {
    return declareBlockers(state, playerId, []);
  }
  const completingEmptyPass =
    state.stack.length === 0 && state.passesSinceAction + 1 >= state.players.length;
  let next = passPriority(state, playerId);
  if (completingEmptyPass) {
    next = advanceStep(next);
    next.priorityPlayerId = priorityForStep(next);
    next.passesSinceAction = 0;
  }
  return next;
}

/**
 * Authoritative entry point for player actions. Illegal actions throw and leave
 * the original GameState unchanged.
 */
export function applyAction(state: GameState, action: GameAction): GameState {
  const before = snapshot(state);
  try {
    switch (action.kind) {
      case "pass_priority":
        return applyPassPriority(state, action.playerId);
      case "cast_spell":
        if (action.targets !== undefined) {
          throw new Error("Targets are not supported");
        }
        return applyCastSpell(state, action.playerId, action.cardId);
      case "declare_attackers":
        return declareAttackers(state, action.playerId, action.attacks);
      case "declare_blockers":
        return declareBlockers(state, action.playerId, action.blocks);
      case "concede":
        throw new Error("Concede is not implemented");
      default: {
        const exhaustive: never = action;
        throw new Error(`Unknown GameAction ${(exhaustive as GameAction).kind}`);
      }
    }
  } catch (error) {
    assertUnchanged(before, state, "Illegal action");
    throw error;
  }
}

export function applyActions(state: GameState, actions: GameAction[]): GameState {
  let current = state;
  for (const action of actions) {
    current = applyAction(current, action);
  }
  return current;
}
