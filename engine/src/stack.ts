import { createId } from "./ids";
import { cloneGameState } from "./clone";
import { isCommander, isInstantOrSorcery } from "./cardTypes";
import { manaValueOf } from "./characteristics";
import {
  abilitiesRemoved,
  activatedOf,
  computedCard,
  grantedActivatedSpread,
} from "./characteristicsEngine";
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
    // Computed, not printed: Lavaspur Boots and friends grant ward.
    const ward = card ? computedCard(state, card.id)?.ward : undefined;
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
  modeIndex?: number,
  sacrificedPower?: number,
  xValue?: number,
): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield" && card.zone !== "hand" && card.zone !== "graveyard") {
    throw new Error(`Card ${cardId} cannot activate from ${card.zone}`);
  }
  const ability = activatedOf(state, cardId)[abilityIndex];
  if (!ability) {
    throw new Error(`Unknown activated ability ${abilityIndex}`);
  }
  // Modal activations: the mode's targets replace the top-level ones.
  const abilityMode = modeIndex !== undefined ? ability.modes?.[modeIndex] : undefined;
  if (ability.modes && ability.modes.length > 0 && !abilityMode) {
    throw new Error("Choose one of the ability's modes");
  }
  if (modeIndex !== undefined && !abilityMode) {
    throw new Error("That ability has no modes");
  }
  const requirements = abilityMode
    ? abilityMode.targetRequirements ?? []
    : ability.targetRequirements;
  validateChosenTargets(state, requirements, targets, card.controllerId, sourceColorsOf(state, cardId), cardId);

  const next = cloneGameState(state);
  const stackId = createId("stack");
  next.stack.push({
    id: stackId,
    controllerId: card.controllerId,
    sourceId: cardId,
    kind: "ability",
    targets: targets.map((target) => ({ ...target })),
    activatedIndex: abilityIndex,
    ...grantedActivatedSpread(state, cardId, abilityIndex),
    ...(modeIndex !== undefined ? { modeIndex } : {}),
    // Altar of Dementia: the sacrificed cost-creature's power.
    ...(sacrificedPower !== undefined ? { sacrificedPower } : {}),
    ...(xValue !== undefined ? { xValue } : {}),
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
  // Impulse exiles: listed cards may be cast from exile this turn — by the
  // listed caster, who takes control of the spell (Etali steals casts).
  const exileEntry =
    located?.zone === "exile"
      ? state.exilePlayable?.find((entry) => entry.cardId === cardId)
      : undefined;
  const fromExilePlay = Boolean(exileEntry);
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
  if (exileEntry) {
    moved.controllerId = exileEntry.casterId;
  }
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
  // Esper Sentinel: per-player noncreature-cast tally for first-spell heads.
  if (!definition?.characteristics.types.includes("creature")) {
    const noncreature = next.noncreatureSpellsCastByPlayerThisTurn ?? {};
    noncreature[moved.controllerId] = (noncreature[moved.controllerId] ?? 0) + 1;
    next.noncreatureSpellsCastByPlayerThisTurn = noncreature;
  }
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
  // Goldspan Dragon: each permanent this SPELL targets. Dispatched once
  // per distinct permanent — a spell that targets the same creature
  // twice still only targeted it once for this purpose.
  const targetedIds = [
    ...new Set(
      targets
        .filter((target) => target.type === "creature")
        .map((target) => target.cardId),
    ),
  ];
  if (targetedIds.length > 0) {
    dispatchEventsInPlace(
      next,
      targetedIds.map((targetId) => ({
        kind: "becomes_target" as const,
        cardId: targetId,
        controllerId: moved.controllerId,
      })),
    );
  }
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
      // The snapshot first, for the same reason as a granted trigger.
      const ability = top.grantedActivated ?? definition?.activated[top.activatedIndex];
      // Sac-modal activations (Cankerbloom): the chosen mode's effects and
      // targets replace the (empty) top-level ones.
      const abilityMode =
        top.modeIndex !== undefined ? ability?.modes?.[top.modeIndex] : undefined;
      const requirements = abilityMode
        ? abilityMode.targetRequirements ?? []
        : ability?.targetRequirements ?? [];
      if (
        ability &&
        hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId)
      ) {
        const bound = bindCardEffects(next, abilityMode ? abilityMode.effects : ability.effects, {
          controllerId: top.controllerId,
          sourceId: top.sourceId,
          targets: top.targets,
          targetRequirements: requirements,
          // Altar of Dementia: the sacrificed cost-creature's power.
          ...(top.sacrificedPower !== undefined ? { sacrificedPower: top.sacrificedPower } : {}),
          // Kessig Wolf Run: the X announced when the ability was activated.
          ...(top.xValue !== undefined ? { xValue: top.xValue } : {}),
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
      // The snapshot first: a granted trigger outlives the grant that made
      // it, so re-reading the source here would resolve nothing.
      const trigger = top.grantedTrigger ?? definition?.triggers[top.triggerIndex ?? 0];
      // Modal trigger: the chosen mode's effects and targets replace the
      // (empty) top-level ones.
      // Black Market Connections: several modes chosen at once resolve in
      // order as ONE ability, so their effects concatenate rather than the
      // first one winning.
      const triggerModes =
        top.modeIndexes && top.modeIndexes.length > 0
          ? top.modeIndexes
              .map((index) => trigger?.modes?.[index])
              .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          : top.modeIndex !== undefined && trigger?.modes?.[top.modeIndex]
            ? [trigger.modes[top.modeIndex]!]
            : [];
      const requirements =
        triggerModes.length > 0
          ? triggerModes.flatMap((entry) => entry.targetRequirements ?? [])
          : trigger?.targetRequirements ?? [];
      if (
        trigger &&
        hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId)
      ) {
        const bound = bindCardEffects(
          next,
          triggerModes.length > 0
            ? triggerModes.flatMap((entry) => entry.effects)
            : trigger.effects,
          {
            controllerId: top.controllerId,
            sourceId: top.sourceId,
            targets: top.targets,
            targetRequirements: requirements,
            ...(top.subjectCardId ? { subjectCardId: top.subjectCardId } : {}),
            ...(top.subjectPlayerId ? { subjectPlayerId: top.subjectPlayerId } : {}),
            ...(top.subjectAmount ? { subjectAmount: top.subjectAmount } : {}),
          },
        );
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
  // Rebound (CR 702.87): a rebound spell cast from hand goes to exile on
  // resolution and is offered free at its caster's next upkeep.
  const rebounds =
    isInstantOrSorcery(next, top.sourceId) &&
    definition?.rebound === true &&
    !top.fromGraveyard &&
    !top.isCopy;
  let destination: ZoneName = isInstantOrSorcery(next, top.sourceId)
    ? top.fromGraveyard || rebounds
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
    // A permanent that arrives HERE arrived by resolving as a spell, which
    // is what "if you cast it" asks. Reanimation and blink do not come
    // through the stack as spells, so they never set it. The flag rides the
    // move rather than being stamped afterwards: the enter triggers are
    // queued inside this call, and an intervening `if` is checked as the
    // trigger goes on the stack.
    next = enterOwnerZone(next, top.sourceId, destination, {
      ...(destination === "battlefield" ? { fromCast: true } : {}),
    });
    if (rebounds && next.cards[top.sourceId]?.zone === "exile") {
      const pending = next.pendingRebounds ?? [];
      pending.push({ cardId: top.sourceId, casterId: top.controllerId });
      next.pendingRebounds = pending;
    }
    if (
      destination === "battlefield" &&
      definition?.entersWithXCounters &&
      (top.xValue ?? 0) > 0 &&
      next.cards[top.sourceId]?.zone === "battlefield"
    ) {
      const entered = next.cards[top.sourceId]!;
      // Everflowing Chalice takes charge counters, not +1/+1. Hardcoding
      // the hydra counter here would give it the wrong kind and leave
      // every ability that reads charge counters seeing none.
      const xCounter = definition.entersWithXCounterKind ?? "p1p1";
      entered.counters[xCounter] = (entered.counters[xCounter] ?? 0) + (top.xValue ?? 0);
    }
    if (destination === "battlefield" && definition?.enterAsCopy?.maxManaValueBySpent) {
      // Mockingbird: the copy cap is the mana spent to cast — the announced X
      // plus the printed pips. The enter prompt was pushed with cap 0.
      const spent = (top.xValue ?? 0) + manaValueOf(definition.manaCost);
      for (const pending of next.prompts) {
        if (pending.kind === "enter_as_copy" && pending.sourceId === top.sourceId) {
          pending.maxManaValue = spent;
        }
      }
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
