import { declareAttackers, declareBlockers, pendingBlockerPlayer, priorityForStep } from "./combat";
import { isCommander, isInstant, isInstantOrSorcery, isLand, isMainPhase } from "./cardTypes";
import { cloneGameState } from "./clone";
import { eliminatePlayerInPlace } from "./elimination";
import { canPayManaCost, parseManaCost, payManaCost } from "./mana";
import { isLiving, livingPlayerCount, requireLiving } from "./players";
import { passPriority, putSpellOnStack } from "./stack";
import { applyStateBasedActionsInPlace, redirectPriorityIfLost } from "./status";
import { validateChosenTargets } from "./targeting";
import { advanceStep, beginNextLivingTurnInPlace } from "./turn";
import { findCardZone, moveCard } from "./zones";
import type { CardInstanceId, ChosenTarget, GameAction, GameState, PlayerId } from "./types";

function requirePlayer(state: GameState, playerId: PlayerId): void {
  if (!state.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player ${playerId}`);
  }
}

function requirePriority(state: GameState, playerId: PlayerId): void {
  requireLiving(state, playerId);
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

function finalizeActionState(state: GameState): GameState {
  applyStateBasedActionsInPlace(state);
  const active = state.players.find((player) => player.id === state.turn.activePlayerId);
  if (active?.lost && livingPlayerCount(state) > 0) {
    beginNextLivingTurnInPlace(state);
    applyStateBasedActionsInPlace(state);
    return state;
  }
  redirectPriorityIfLost(state);
  return state;
}

function validateCast(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): { cost: ReturnType<typeof parseManaCost>; fromCommand: boolean } {
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
  const fromHand = Boolean(located && located.zone === "hand" && located.playerId === playerId);
  const fromCommand = Boolean(
    located &&
      located.zone === "command" &&
      located.playerId === playerId &&
      isCommander(state, cardId),
  );
  if (!fromHand && !fromCommand) {
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
  const cost = parseManaCost(definition.manaCost);
  if (fromCommand) {
    cost.generic += player.commander.tax;
  }
  if (!canPayManaCost(player.mana, cost)) {
    throw new Error("Cannot pay mana cost");
  }

  return { cost, fromCommand };
}

function applyCastSpell(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targets: ChosenTarget[] | undefined,
): GameState {
  const { cost, fromCommand } = validateCast(state, playerId, cardId);
  const card = state.cards[cardId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  validateChosenTargets(state, definition?.targetRequirements ?? [], targets ?? []);
  const paid = payManaCost(state, playerId, cost);
  const stacked = putSpellOnStack(paid, cardId, targets ?? []);
  if (!fromCommand) {
    return stacked;
  }
  const caster = stacked.players.find((player) => player.id === playerId);
  if (!caster) {
    throw new Error(`Unknown player ${playerId}`);
  }
  caster.commander.tax += 2;
  return stacked;
}

function applyPlayLand(state: GameState, playerId: PlayerId, cardId: CardInstanceId): GameState {
  requirePriority(state, playerId);
  if (playerId !== state.turn.activePlayerId) {
    throw new Error("Only the active player can play a land");
  }
  if (!isMainPhase(state)) {
    throw new Error("A land can only be played during a main phase");
  }
  if (state.stack.length > 0) {
    throw new Error("A land can only be played when the stack is empty");
  }

  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (!isLand(state, cardId)) {
    throw new Error(`Card ${cardId} is not a land`);
  }

  const located = findCardZone(state, cardId);
  if (!located || located.zone !== "hand" || located.playerId !== playerId) {
    throw new Error(`Card ${cardId} must be in the player's hand`);
  }

  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (player.landsPlayedThisTurn >= 1) {
    throw new Error("Already played a land this turn");
  }

  const next = moveCard(state, cardId, "battlefield");
  const movedPlayer = next.players.find((entry) => entry.id === playerId);
  if (!movedPlayer) {
    throw new Error(`Unknown player ${playerId}`);
  }
  movedPlayer.landsPlayedThisTurn += 1;
  next.passesSinceAction = 0;
  next.priorityPlayerId = playerId;
  return next;
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
    state.stack.length === 0 && state.passesSinceAction + 1 >= livingPlayerCount(state);
  let next = passPriority(state, playerId);
  if (completingEmptyPass) {
    next = advanceStep(next);
    next.priorityPlayerId = priorityForStep(next);
    next.passesSinceAction = 0;
  }
  return next;
}

function applyConcede(state: GameState, playerId: PlayerId): GameState {
  requirePlayer(state, playerId);
  if (!isLiving(state, playerId)) {
    throw new Error("That player has already lost");
  }
  const next = cloneGameState(state);
  eliminatePlayerInPlace(next, playerId);
  return next;
}

/**
 * Authoritative entry point for player actions. Illegal actions throw and leave
 * the original GameState unchanged.
 */
export function applyAction(state: GameState, action: GameAction): GameState {
  const before = snapshot(state);
  try {
    let next: GameState;
    switch (action.kind) {
      case "pass_priority":
        next = applyPassPriority(state, action.playerId);
        break;
      case "cast_spell":
        next = applyCastSpell(state, action.playerId, action.cardId, action.targets);
        break;
      case "play_land":
        next = applyPlayLand(state, action.playerId, action.cardId);
        break;
      case "declare_attackers":
        requireLiving(state, action.playerId);
        next = declareAttackers(state, action.playerId, action.attacks);
        break;
      case "declare_blockers":
        requireLiving(state, action.playerId);
        next = declareBlockers(state, action.playerId, action.blocks);
        break;
      case "concede":
        next = applyConcede(state, action.playerId);
        break;
      default: {
        const exhaustive: never = action;
        throw new Error(`Unknown GameAction ${(exhaustive as GameAction).kind}`);
      }
    }
    return finalizeActionState(next);
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
