import { createId } from "./ids";
import { cloneGameState } from "./clone";
import { isCommander, isInstantOrSorcery } from "./cardTypes";
import { abilitiesRemoved } from "./characteristicsEngine";
import { enterOwnerZone, findCardZone, removeCardFromCurrentZone } from "./zones";
import { applyEffects, bindCardEffects } from "./effects";
import { isLiving, livingPlayerCount, nextLivingPlayerId } from "./players";
import { applyStateBasedActionsInPlace, redirectPriorityIfLost } from "./status";
import { dispatchEventsInPlace } from "./triggers";
import { hasLegalTargetRemaining, isChosenTargetLegal, sourceColorsOf, validateChosenTargets } from "./targeting";
import type {
  CardInstanceId,
  ChosenTarget,
  GameEffect,
  GameState,
  PlayerId,
  StackObjectId,
  ZoneName,
} from "./types";

/**
 * Ward (CR 702.21 as of its modern form): targeting an opponent's warded
 * permanent taxes the caster — pay or the spell/ability is countered.
 * Simplified as an immediate payment pause rather than a stacked trigger.
 */
function queueWardPromptsInPlace(
  state: GameState,
  stackObjectId: StackObjectId,
  casterId: PlayerId,
  targets: ChosenTarget[],
): void {
  for (const target of targets) {
    if (target.type !== "creature") {
      continue;
    }
    const card = state.cards[target.cardId];
    const ward = card ? state.definitions[card.definitionId]?.ward : undefined;
    if (!card || !ward || ward <= 0 || card.controllerId === casterId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    state.prompts.push({
      kind: "pay_or_counter",
      playerId: casterId,
      cost: `{${ward}}`,
      stackObjectId,
      reason: "ward",
    });
  }
}

export function putActivatedAbilityOnStack(
  state: GameState,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: ChosenTarget[] = [],
): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield" && card.zone !== "hand" && card.zone !== "graveyard") {
    throw new Error(`Card ${cardId} cannot activate from ${card.zone}`);
  }
  const definition = state.definitions[card.definitionId];
  const ability = definition?.activated[abilityIndex];
  if (!ability) {
    throw new Error(`Unknown activated ability ${abilityIndex}`);
  }
  validateChosenTargets(state, ability.targetRequirements, targets, card.controllerId, sourceColorsOf(state, cardId));

  const next = cloneGameState(state);
  const stackId = createId("stack");
  next.stack.push({
    id: stackId,
    controllerId: card.controllerId,
    sourceId: cardId,
    kind: "ability",
    targets: targets.map((target) => ({ ...target })),
    activatedIndex: abilityIndex,
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = card.controllerId;
  queueWardPromptsInPlace(next, stackId, card.controllerId, targets);
  return next;
}

export function putSpellOnStack(
  state: GameState,
  cardId: CardInstanceId,
  targets: ChosenTarget[] = [],
  modeIndex?: number,
  xValue?: number,
  division?: number[],
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
  const requirements =
    modeIndex !== undefined && definition?.modes?.[modeIndex]
      ? definition.modes[modeIndex]!.targetRequirements
      : definition?.targetRequirements ?? [];
  validateChosenTargets(state, requirements, targets, card.controllerId, sourceColorsOf(state, cardId));

  let next = cloneGameState(state);
  next = removeCardFromCurrentZone(next, cardId);
  const moved = next.cards[cardId];
  if (!moved) {
    throw new Error(`Card ${cardId} missing after leaving hand`);
  }
  moved.zone = "stack";
  const stackId = createId("stack");
  next.stack.push({
    id: stackId,
    controllerId: moved.controllerId,
    sourceId: cardId,
    kind: "spell",
    targets: targets.map((target) => ({ ...target })),
    ...(modeIndex !== undefined ? { modeIndex } : {}),
    ...(xValue !== undefined ? { xValue } : {}),
    ...(division !== undefined ? { division: [...division] } : {}),
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = moved.controllerId;
  // Cast triggers (Guttersnipe, Rhystic Study) go on the stack above the spell.
  dispatchEventsInPlace(next, [
    { kind: "casts", cardId, controllerId: moved.controllerId },
  ]);
  queueWardPromptsInPlace(next, stackId, moved.controllerId, targets);
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
    if (top.activatedIndex !== undefined) {
      const ability = definition?.activated[top.activatedIndex];
      const requirements = ability?.targetRequirements ?? [];
      if (
        ability &&
        hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId))
      ) {
        const bound = bindCardEffects(next, ability.effects, {
          controllerId: top.controllerId,
          sourceId: top.sourceId,
          targets: top.targets,
          targetRequirements: requirements,
        });
        next = applyEffects(next, bound);
      }
    } else if (top.loyaltyIndex !== undefined) {
      const ability = definition?.loyaltyAbilities?.[top.loyaltyIndex];
      const requirements = ability?.targetRequirements ?? [];
      if (
        ability &&
        hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId))
      ) {
        const bound = bindCardEffects(next, ability.effects, {
          controllerId: top.controllerId,
          sourceId: top.sourceId,
          targets: top.targets,
          targetRequirements: requirements,
        });
        next = applyEffects(next, bound);
      }
    } else {
      const trigger = definition?.triggers[top.triggerIndex ?? 0];
      const requirements = trigger?.targetRequirements ?? [];
      if (
        trigger &&
        hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId))
      ) {
        const bound = bindCardEffects(next, trigger.effects, {
          controllerId: top.controllerId,
          sourceId: top.sourceId,
          targets: top.targets,
          targetRequirements: requirements,
        });
        next = applyEffects(next, bound);
      }
    }
    applyStateBasedActionsInPlace(next);
    redirectPriorityIfLost(next);
    return next;
  }

  const source = next.cards[top.sourceId];
  const definition = source ? next.definitions[source.definitionId] : undefined;
  const mode =
    top.modeIndex !== undefined ? definition?.modes?.[top.modeIndex] : undefined;
  const requirements = mode ? mode.targetRequirements : definition?.targetRequirements ?? [];
  const effects = mode ? mode.effects : definition?.effects ?? [];
  const shouldResolveEffects =
    effects.length > 0 &&
    hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId));
  if (shouldResolveEffects && definition) {
    const divided = effects.find((effect) => effect.kind === "divided_damage");
    if (divided?.kind === "divided_damage") {
      // Each target takes its announced share; targets that became illegal
      // lose their share (CR 608.2b).
      const requirement = requirements[0];
      const damage: GameEffect[] = [];
      top.targets.forEach((target, index) => {
        const share = top.division?.[index] ?? 0;
        if (
          share <= 0 ||
          !requirement ||
          !isChosenTargetLegal(next, requirement, target, top.controllerId, sourceColorsOf(next, top.sourceId)) ||
          target.type === "spell"
        ) {
          return;
        }
        damage.push({
          kind: "deal_damage",
          sourceId: divided.sourceId === "self" ? top.sourceId : divided.sourceId,
          amount: share,
          target,
        });
      });
      next = applyEffects(next, damage);
    } else {
      const bound = bindCardEffects(next, effects, {
        controllerId: top.controllerId,
        sourceId: top.sourceId,
        targets: top.targets,
        targetRequirements: requirements,
        xValue: top.xValue,
      });
      next = applyEffects(next, bound);
    }
  }

  let destination: ZoneName = isInstantOrSorcery(next, top.sourceId)
    ? "graveyard"
    : "battlefield";
  let attachTo: CardInstanceId | null = null;
  if (definition?.enchant && destination === "battlefield") {
    // An Aura enters attached to its target; with no legal target left, the
    // spell fizzled and the card goes to the graveyard instead (CR 303.4).
    const target = top.targets[0];
    if (
      target?.type === "creature" &&
      hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId))
    ) {
      attachTo = target.cardId;
    } else {
      destination = "graveyard";
    }
  }
  // CR 800.4a: if the spell's owner left the game mid-resolution (say, a
  // failed draw the spell itself caused), the card has already been removed —
  // only a card still in the stack zone moves on to its destination.
  if (next.cards[top.sourceId]?.zone === "stack") {
    next = enterOwnerZone(next, top.sourceId, destination);
  }
  if (attachTo && next.cards[top.sourceId]?.zone === "battlefield") {
    next.cards[top.sourceId]!.attachedTo = attachTo;
  }
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
