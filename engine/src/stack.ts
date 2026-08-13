import { createId } from "./ids";
import { cloneGameState } from "./clone";
import { isCommander, isInstantOrSorcery } from "./cardTypes";
import { enterOwnerZone, findCardZone, removeCardFromCurrentZone } from "./zones";
import { applyEffects, bindCardEffects } from "./effects";
import { isLiving, livingPlayerCount, nextLivingPlayerId } from "./players";
import { applyStateBasedActionsInPlace, redirectPriorityIfLost } from "./status";
import { hasLegalTargetRemaining, validateChosenTargets } from "./targeting";
import type { CardInstanceId, ChosenTarget, GameState, PlayerId, ZoneName } from "./types";

export function putSpellOnStack(
  state: GameState,
  cardId: CardInstanceId,
  targets: ChosenTarget[] = [],
): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const located = findCardZone(state, cardId);
  const fromCommand = located?.zone === "command" && isCommander(state, cardId);
  if (!located || (located.zone !== "hand" && !fromCommand)) {
    throw new Error(`Card ${cardId} must be in hand to put on the stack`);
  }
  const definition = state.definitions[card.definitionId];
  validateChosenTargets(state, definition?.targetRequirements ?? [], targets, card.controllerId);

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
    targets: targets.map((target) => ({ ...target })),
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = moved.controllerId;
  return next;
}

export function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    throw new Error("Stack is empty");
  }
  let next = cloneGameState(state);
  const top = next.stack.pop();
  if (!top) {
    throw new Error("Stack is empty");
  }
  next.passesSinceAction = 0;
  next.priorityPlayerId = next.turn.activePlayerId;

  if (!top.sourceId) {
    applyStateBasedActionsInPlace(next);
    redirectPriorityIfLost(next);
    return next;
  }

  if (top.kind === "ability") {
    const source = next.cards[top.sourceId];
    const definition = source ? next.definitions[source.definitionId] : undefined;
    const trigger = definition?.triggers[top.triggerIndex ?? 0];
    if (trigger) {
      const bound = bindCardEffects(next, trigger.effects, {
        controllerId: top.controllerId,
        sourceId: top.sourceId,
        targets: top.targets,
        targetRequirements: [],
      });
      next = applyEffects(next, bound);
    }
    applyStateBasedActionsInPlace(next);
    redirectPriorityIfLost(next);
    return next;
  }

  const source = next.cards[top.sourceId];
  const definition = source ? next.definitions[source.definitionId] : undefined;
  const requirements = definition?.targetRequirements ?? [];
  const shouldResolveEffects =
    Boolean(definition && definition.effects.length > 0) &&
    hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId);
  if (shouldResolveEffects && definition) {
    const bound = bindCardEffects(next, definition.effects, {
      controllerId: top.controllerId,
      sourceId: top.sourceId,
      targets: top.targets,
      targetRequirements: requirements,
    });
    next = applyEffects(next, bound);
  }

  const destination: ZoneName = isInstantOrSorcery(next, top.sourceId)
    ? "graveyard"
    : "battlefield";
  next = enterOwnerZone(next, top.sourceId, destination);
  applyStateBasedActionsInPlace(next);
  redirectPriorityIfLost(next);
  return next;
}

export function passPriority(state: GameState, playerId: PlayerId): GameState {
  if (playerId !== state.priorityPlayerId) {
    throw new Error("It is not that player's priority");
  }
  if (!isLiving(state, playerId)) {
    throw new Error("That player has lost");
  }
  let next = cloneGameState(state);
  next.passesSinceAction += 1;
  if (next.passesSinceAction < livingPlayerCount(next)) {
    next.priorityPlayerId = nextLivingPlayerId(next, playerId);
    return next;
  }

  if (next.stack.length > 0) {
    return resolveTopOfStack(next);
  }

  next.passesSinceAction = 0;
  next.priorityPlayerId = isLiving(next, next.turn.activePlayerId)
    ? next.turn.activePlayerId
    : nextLivingPlayerId(next, next.turn.activePlayerId);
  return next;
}
