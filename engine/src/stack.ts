import { createId } from "./ids";
import { cloneGameState } from "./clone";
import { isCommander, isInstantOrSorcery } from "./cardTypes";
import { abilitiesRemoved } from "./characteristicsEngine";
import { castableFromTop } from "./derived";
import { controlsMatching } from "./legalActions";
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
  validateChosenTargets(state, ability.targetRequirements, targets, card.controllerId, sourceColorsOf(state, cardId), cardId);

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
  modeIndexes?: number[],
  sacrificedPower?: number,
): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const located = findCardZone(state, cardId);
  const fromCommand = located?.zone === "command" && isCommander(state, cardId);
  // Oracle of Mul Daya-style grants: the top card of the caster's library is
  // castable as though it were in hand.
  const fromLibraryTop =
    located?.zone === "library" &&
    castableFromTop(state, state.cards[cardId]?.controllerId ?? "", cardId);
  // Flashback (CR 702.34): an instant or sorcery with a flashback cost can be
  // cast from its owner's graveyard; it will exile as it leaves the stack.
  const fromFlashback =
    located?.zone === "graveyard" &&
    Boolean(state.definitions[state.cards[cardId]?.definitionId ?? ""]?.flashback) &&
    isInstantOrSorcery(state, cardId);
  // Gravecrawler: a gated normal cast from the graveyard (no exile rider).
  const graveyardGate = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.castFromGraveyard;
  const fromGraveyardGate =
    located?.zone === "graveyard" &&
    Boolean(graveyardGate) &&
    controlsMatching(state, state.cards[cardId]?.controllerId ?? "", graveyardGate!);
  // Impulse exiles: listed cards may be cast from exile this turn.
  const fromExilePlay =
    located?.zone === "exile" &&
    Boolean(
      state.exilePlayable?.some(
        (entry) => entry.cardId === cardId && entry.casterId === card.controllerId,
      ),
    );
  if (
    !located ||
    (located.zone !== "hand" &&
      !fromCommand &&
      !fromLibraryTop &&
      !fromFlashback &&
      !fromGraveyardGate &&
      !fromExilePlay)
  ) {
    throw new Error(`Card ${cardId} must be in hand to put on the stack`);
  }
  const definition = state.definitions[card.definitionId];
  const requirements =
    modeIndexes && modeIndexes.length > 0 && definition?.modes
      ? modeIndexes.flatMap((index) => definition.modes![index]?.targetRequirements ?? [])
      : modeIndex !== undefined && definition?.modes?.[modeIndex]
        ? definition.modes[modeIndex]!.targetRequirements
        : definition?.targetRequirements ?? [];
  validateChosenTargets(state, requirements, targets, card.controllerId, sourceColorsOf(state, cardId), cardId);

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
    ...(modeIndexes && modeIndexes.length > 0 ? { modeIndexes: [...modeIndexes] } : {}),
    ...(xValue !== undefined ? { xValue } : {}),
    ...(sacrificedPower !== undefined ? { sacrificedPower } : {}),
    ...(division !== undefined ? { division: [...division] } : {}),
    ...(fromFlashback ? { fromGraveyard: true } : {}),
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = moved.controllerId;
  // Storm (CR 702.40): one copy per spell cast before this one this turn.
  // Documented approximation: copies appear immediately (not as a stacked
  // trigger) and keep the original's targets and mode.
  const stormCount = next.spellsCastThisTurn;
  next.spellsCastThisTurn += 1;
  const byPlayer = next.spellsCastByPlayerThisTurn ?? {};
  byPlayer[moved.controllerId] = (byPlayer[moved.controllerId] ?? 0) + 1;
  next.spellsCastByPlayerThisTurn = byPlayer;
  if (definition?.storm && stormCount > 0) {
    for (let copyIndex = 0; copyIndex < stormCount; copyIndex += 1) {
      next.stack.push({
        id: createId("stack"),
        controllerId: moved.controllerId,
        sourceId: cardId,
        kind: "spell",
        targets: targets.map((target) => ({ ...target })),
        ...(modeIndex !== undefined ? { modeIndex } : {}),
        ...(modeIndexes && modeIndexes.length > 0 ? { modeIndexes: [...modeIndexes] } : {}),
        ...(xValue !== undefined ? { xValue } : {}),
        ...(division !== undefined ? { division: [...division] } : {}),
        isCopy: true,
      });
    }
  }
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
        hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId)
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
        hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId)
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
        hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId)
      ) {
        const bound = bindCardEffects(next, trigger.effects, {
          controllerId: top.controllerId,
          sourceId: top.sourceId,
          targets: top.targets,
          targetRequirements: requirements,
          ...(top.subjectCardId ? { subjectCardId: top.subjectCardId } : {}),
          ...(top.subjectPlayerId ? { subjectPlayerId: top.subjectPlayerId } : {}),
          ...(top.subjectAmount ? { subjectAmount: top.subjectAmount } : {}),
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
  // Multi-mode spells resolve each chosen bullet in order, each with its own
  // slice of the chosen targets; an illegal slice fizzles just that mode.
  if (top.modeIndexes && top.modeIndexes.length > 0 && definition?.modes) {
    let offset = 0;
    for (const index of top.modeIndexes) {
      const chosenMode = definition.modes[index];
      if (!chosenMode) {
        continue;
      }
      const slice = top.targets.slice(offset, offset + chosenMode.targetRequirements.length);
      offset += chosenMode.targetRequirements.length;
      if (
        chosenMode.effects.length === 0 ||
        !hasLegalTargetRemaining(next, chosenMode.targetRequirements, slice, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId)
      ) {
        continue;
      }
      const bound = bindCardEffects(next, chosenMode.effects, {
        controllerId: top.controllerId,
        sourceId: top.sourceId,
        targets: slice,
        targetRequirements: chosenMode.targetRequirements,
        xValue: top.xValue,
      });
      next = applyEffects(next, bound);
    }
    // A resolved copy ceases to exist (CR 707.10a); the source card belongs to
    // the original spell, which may still be on the stack beneath it.
    if (!top.isCopy && next.cards[top.sourceId]?.zone === "stack") {
      next = enterOwnerZone(
        next,
        top.sourceId,
        isInstantOrSorcery(next, top.sourceId)
          ? top.fromGraveyard
            ? "exile"
            : "graveyard"
          : "battlefield",
      );
      // Dash (CR 702.109): the permanent enters hasty and bounces at the
      // beginning of the next end step.
      const dashed = (top.modeIndexes ?? (top.modeIndex !== undefined ? [top.modeIndex] : [])).some(
        (index) => definition?.modes?.[index]?.dash,
      );
      const entered = next.cards[top.sourceId];
      if (dashed && entered && entered.zone === "battlefield") {
        entered.summoningSick = false;
        next.delayedEndStep.push({ cardId: top.sourceId, action: "hand" });
      }
    }
    applyStateBasedActionsInPlace(next);
    redirectPriorityIfLost(next);
    return next;
  }
  const mode =
    top.modeIndex !== undefined ? definition?.modes?.[top.modeIndex] : undefined;
  const requirements = mode ? mode.targetRequirements : definition?.targetRequirements ?? [];
  const effects = mode ? mode.effects : definition?.effects ?? [];
  const shouldResolveEffects =
    effects.length > 0 &&
    hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId);
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
        ...(top.sacrificedPower !== undefined ? { sacrificedPower: top.sacrificedPower } : {}),
      });
      next = applyEffects(next, bound);
    }
  }

  // Flashback exile replacement (CR 702.34a): a flashbacked card leaves the
  // stack to exile instead of anywhere else.
  let destination: ZoneName = isInstantOrSorcery(next, top.sourceId)
    ? top.fromGraveyard
      ? "exile"
      : "graveyard"
    : "battlefield";
  let attachTo: CardInstanceId | null = null;
  if (definition?.enchant && destination === "battlefield") {
    // An Aura enters attached to its target; with no legal target left, the
    // spell fizzled and the card goes to the graveyard instead (CR 303.4).
    const target = top.targets[0];
    if (
      target?.type === "creature" &&
      hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId)
    ) {
      attachTo = target.cardId;
    } else {
      destination = "graveyard";
    }
  }
  // CR 800.4a: if the spell's owner left the game mid-resolution (say, a
  // failed draw the spell itself caused), the card has already been removed —
  // only a card still in the stack zone moves on to its destination. A copy
  // ceases to exist instead: its source card belongs to the original spell,
  // which may still be on the stack beneath it (CR 707.10a).
  if (!top.isCopy && next.cards[top.sourceId]?.zone === "stack") {
    next = enterOwnerZone(next, top.sourceId, destination);
    if (
      destination === "battlefield" &&
      definition?.entersWithXCounters &&
      (top.xValue ?? 0) > 0 &&
      next.cards[top.sourceId]?.zone === "battlefield"
    ) {
      const entered = next.cards[top.sourceId]!;
      entered.counters["p1p1"] = (entered.counters["p1p1"] ?? 0) + (top.xValue ?? 0);
    }
    // Dash (CR 702.109): hasty, and home again at the next end step.
    const dashed =
      top.modeIndex !== undefined && definition?.modes?.[top.modeIndex]?.dash === true;
    const dashedCard = next.cards[top.sourceId];
    if (dashed && dashedCard && dashedCard.zone === "battlefield") {
      dashedCard.summoningSick = false;
      next.delayedEndStep.push({ cardId: top.sourceId, action: "hand" });
    }
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
