import { createId } from "./ids";
import { cloneGameState } from "./clone";
import { isCommander, isInstantOrSorcery, isLand } from "./cardTypes";
import { manaValueOf } from "./characteristics";
import {
  abilitiesRemoved,
  activatedOf,
  computedCard,
  grantedActivatedSpread,
} from "./characteristicsEngine";
import { castableFromTop, retraceReaches } from "./derived";
import { controlsMatching } from "./legalActions";
import { enterOwnerZone, findCardZone, moveCard, removeCardFromCurrentZone } from "./zones";
import { applyEffects, bindCardEffects } from "./effects";
import { isLiving, livingPlayerCount, nextLivingPlayerId } from "./players";
import { applyStateBasedActionsInPlace, redirectPriorityIfLost } from "./status";
import { dispatchEventsInPlace } from "./triggers";
import { firstLegalTargetSet, hasLegalTargetRemaining, isChosenTargetLegal, sourceColorsOf, validateChosenTargets } from "./targeting";
import type {
  CardInstanceId,
  ChosenTarget,
  GameEffect,
  GameState,
  PlayerId,
  StackObjectId,
  TargetRequirement,
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
    const computed = card ? computedCard(state, card.id) : undefined;
    if (!card || card.controllerId === casterId || abilitiesRemoved(state, card.id)) {
      continue;
    }
    const ward = computed?.ward ?? 0;
    const wardLife = computed?.wardLife ?? 0;
    if (ward > 0) {
      state.prompts.push({
        kind: "pay_or_counter",
        playerId: casterId,
        cost: `{${ward}}`,
        stackObjectId,
        reason: "ward",
      });
    }
    // A permanent with both taxes twice: CR 702.21c has each ward ability
    // trigger separately, and two prompts is the closest this engine's
    // single-payment shape gets to that.
    if (wardLife > 0) {
      state.prompts.push({
        kind: "pay_or_counter",
        playerId: casterId,
        // No mana is due at all; "{0}" says so and, unlike an empty
        // string, survives the wire.
        cost: "{0}",
        stackObjectId,
        reason: "ward",
        life: wardLife,
      });
    }
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
  sacrificedManaValue?: number,
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
  const printedRequirements = abilityMode
    ? abilityMode.targetRequirements ?? []
    : ability.targetRequirements;
  // The Mycosynth Gardens: "with mana value X" is EXACTLY the announced X.
  // This is the only place that value is known — `isChosenTargetLegal` is
  // called from a dozen sites that have no idea what was announced — so the
  // requirement is resolved to a matching min/max pair here.
  const requirements = printedRequirements.map((requirement) =>
    requirement.manaValueEqualsX
      ? {
          ...requirement,
          manaValueEqualsX: undefined,
          maxManaValue: xValue ?? 0,
          minManaValue: xValue ?? 0,
        }
      : requirement,
  );
  validateChosenTargets(
    state,
    requirements,
    targets,
    card.controllerId,
    sourceColorsOf(state, cardId),
    cardId,
    // Ruthless Technomancer: the announced X (its sacrifice count) bounds
    // "power X or less", so it has to reach the target check.
    xValue,
  );

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
    ...(sacrificedManaValue !== undefined ? { sacrificedManaValue } : {}),
    ...(xValue !== undefined ? { xValue } : {}),
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = card.controllerId;
  queueWardPromptsInPlace(next, stackId, card.controllerId, targets);
  // Rings of Brighthearth watches this. Mana abilities never reach here (they
  // do not use the stack), so the "if it isn't a mana ability" clause holds
  // by construction.
  dispatchEventsInPlace(next, [
    { kind: "activated_ability", playerId: card.controllerId, stackObjectId: stackId },
  ]);
  return next;
}

/**
 * Bestow (CR 702.103): the spell is an Aura spell, so it targets a creature —
 * a requirement the printed card, which is a creature, does not carry. Named
 * once so the cast check and the resolution fizzle-check cannot drift apart.
 */
const BESTOW_REQUIREMENTS: TargetRequirement[] = [{ kind: "creature" }];

export function putSpellOnStack(
  state: GameState,
  cardId: CardInstanceId,
  targets: ChosenTarget[] = [],
  modeIndex?: number,
  xValue?: number,
  division?: number[],
  modeIndexes?: number[],
  sacrificedPower?: number,
  sacrificedManaValue?: number,
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
    (Boolean(state.definitions[state.cards[cardId]?.definitionId ?? ""]?.flashback) ||
      state.cards[cardId]?.flashbackUntilEot === true) &&
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
    located?.zone === "exile" || located?.zone === "graveyard"
      ? state.exilePlayable?.find((entry) => entry.cardId === cardId)
      : undefined;
  const fromExilePlay = Boolean(exileEntry);
  // Squee, the Immortal: a standing permission to cast from exile, written on
  // the card rather than granted to the instance.
  const fromExileStanding =
    located?.zone === "exile" &&
    state.definitions[state.cards[cardId]?.definitionId ?? ""]?.castFromExile === true;
  // Underworld Breach: escape is granted by a PERMANENT, not written on the
  // card, so this gate has to look at the board. The cast action validates
  // and pays for it; without the same reading here the spell would be paid
  // for and then refused the stack.
  const fromEscape =
    located?.zone === "graveyard" &&
    !isLand(state, cardId) &&
    Object.values(state.cards).some(
      (permanent) =>
        permanent.zone === "battlefield" &&
        permanent.controllerId === located.playerId &&
        Boolean(state.definitions[permanent.definitionId]?.grantsEscape),
    );
  // Retrace: a graveyard cast with no exile rider, so the card comes back
  // here when it resolves and can be cast again for another land.
  const fromRetrace =
    located?.zone === "graveyard" &&
    retraceReaches(state, located.playerId, cardId);
  if (
    !located ||
    (located.zone !== "hand" &&
      !fromCommand &&
      !fromLibraryTop &&
      !fromFlashback &&
      !fromGraveyardGate &&
      !fromEscape &&
      !fromRetrace &&
      !fromExilePlay &&
      !fromExileStanding)
  ) {
    throw new Error(`Card ${cardId} must be in hand to put on the stack`);
  }
  const definition = state.definitions[card.definitionId];
  const requirements = card.bestowed
    ? // Bestow: cast as an AURA spell, which targets the creature it will
      // enchant. The printed card is a creature and has no target at all.
      BESTOW_REQUIREMENTS
    : modeIndexes && modeIndexes.length > 0 && definition?.modes
      ? modeIndexes.flatMap((index) => definition.modes![index]?.targetRequirements ?? [])
      : modeIndex !== undefined && definition?.modes?.[modeIndex]
        ? definition.modes[modeIndex]!.targetRequirements
        : definition?.targetRequirements ?? [];
  validateChosenTargets(state, requirements, targets, card.controllerId, sourceColorsOf(state, cardId), cardId);

  // Approach of the Second Sun: where it was cast FROM, read before the
  // card leaves that zone and kept on the instance, because by the time
  // the spell resolves the stack entry is gone.
  const castFromZone = state.cards[cardId]?.zone;
  let next = cloneGameState(state);
  next = removeCardFromCurrentZone(next, cardId);
  const moved = next.cards[cardId];
  if (!moved) {
    throw new Error(`Card ${cardId} missing after leaving hand`);
  }
  moved.zone = "stack";
  if (castFromZone) {
    moved.castFromZone = castFromZone;
  }
  // Approach of the Second Sun again: a per-name tally for the whole game.
  // Counted here, so the current cast is already in it — "ANOTHER spell
  // named this" is therefore two, not one.
  const castName = state.definitions[moved.definitionId]?.name;
  if (castName) {
    const byPlayer = { ...(next.spellsCastByNameThisGame ?? {}) };
    const forPlayer = { ...(byPlayer[moved.controllerId] ?? {}) };
    forPlayer[castName] = (forPlayer[castName] ?? 0) + 1;
    byPlayer[moved.controllerId] = forPlayer;
    next.spellsCastByNameThisGame = byPlayer;
  }
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
    ...(sacrificedManaValue !== undefined ? { sacrificedManaValue } : {}),
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
  // Veil of Summer and the Traps ask what COLOUR was cast, which the count
  // above cannot be made to answer afterwards. Recorded here, beside it.
  const castColors = definition?.characteristics.colors ?? [];
  if (castColors.length > 0) {
    const colorsByPlayer = next.spellColorsCastByPlayerThisTurn ?? {};
    const seenColors = [...(colorsByPlayer[moved.controllerId] ?? [])];
    for (const color of castColors) {
      if (!seenColors.includes(color)) {
        seenColors.push(color);
      }
    }
    colorsByPlayer[moved.controllerId] = seenColors;
    next.spellColorsCastByPlayerThisTurn = colorsByPlayer;
  }
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
  /**
   * Cascade (CR 702.85) triggers when the spell is CAST, and its exiled card
   * is cast while the cascading spell is still on the stack. Running it here
   * rather than at resolution is what preserves that ordering: the free-cast
   * window opens now, so the cascaded spell can be cast — and resolve —
   * first, the way the printed card works.
   *
   * A count rather than a boolean: Maelstrom Wanderer cascades twice and
   * Apex Devastator four times, and each is its own walk down the library.
   */
  const cascadeDefinition = next.definitions[moved.definitionId];
  const cascade = cascadeDefinition?.cascade ?? 0;
  if (cascade > 0) {
    const ceiling = manaValueOf(cascadeDefinition?.manaCost ?? "") - 1;
    for (let index = 0; index < cascade; index += 1) {
      next = applyEffects(next, [
        { kind: "discover", playerId: moved.controllerId, maxManaValue: ceiling },
      ]);
    }
  }
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
          ...(top.sacrificedManaValue !== undefined
            ? { sacrificedManaValue: top.sacrificedManaValue }
            : {}),
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
          ...(top.xValue !== undefined ? { xValue: top.xValue } : {}),
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
            ...(top.subjectStackObjectId
              ? { subjectStackObjectId: top.subjectStackObjectId }
              : {}),
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
  const requirements = next.cards[top.sourceId]?.bestowed
    ? BESTOW_REQUIREMENTS
    : mode
      ? mode.targetRequirements
      : definition?.targetRequirements ?? [];
  const printed = mode ? mode.effects : definition?.effects ?? [];
  // Splice onto Arcane: the revealed cards' effects join this spell's,
  // after them, in the order they were spliced (CR 702.47a).
  const spliced = (top.splicedFrom ?? []).flatMap((spliceId) => {
    const spliceDefinition = next.definitions[next.cards[spliceId]?.definitionId ?? ""];
    return spliceDefinition?.effects ?? [];
  });
  const effects = spliced.length > 0 ? [...printed, ...spliced] : printed;
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
        ...(top.sacrificedManaValue !== undefined
          ? { sacrificedManaValue: top.sacrificedManaValue }
          : {}),
      });
      next = applyEffects(next, bound);
    }
  }

  // Sevinne's Reclamation: "If this spell was cast from a graveyard, you may
  // copy this spell and may choose a new target for the copy." The spell has
  // already left the stack by the time its effects bind, so the copy is
  // pushed here, from the resolving object itself.
  //
  // The copy gets FRESH targets rather than the original's. Keeping them
  // would aim it at the permanent this resolution just returned to the
  // battlefield, where it is no longer a legal graveyard target — the card
  // would compile, resolve, and reliably do nothing. The choice is
  // auto-taken, the documented approximation `draw.optional` already uses.
  if (definition?.copySelfWhenCastFromGraveyard && top.fromGraveyard && !top.isCopy) {
    const fresh = firstLegalTargetSet(next, requirements, top.controllerId);
    if (fresh) {
      next = cloneGameState(next);
      next.stack.push({
        id: createId("stack"),
        controllerId: top.controllerId,
        sourceId: top.sourceId,
        kind: "spell",
        targets: fresh,
        ...(top.modeIndex !== undefined ? { modeIndex: top.modeIndex } : {}),
        ...(top.modeIndexes ? { modeIndexes: [...top.modeIndexes] } : {}),
        ...(top.xValue !== undefined ? { xValue: top.xValue } : {}),
        isCopy: true,
      });
      // NOT fromGraveyard: the copy was never cast, and carrying the flag
      // would have it copy itself again without end.
      dispatchEventsInPlace(next, [
        { kind: "copies_spell", cardId: top.sourceId, controllerId: top.controllerId },
      ]);
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
  let attachToPlayer: PlayerId | null = null;
  // Bestow: the permanent enters attached, exactly as an Aura does, and
  // fizzles to the graveyard if its host is gone — CR 702.103c, which is
  // the same rule an Aura spell follows.
  const bestowing = next.cards[top.sourceId]?.bestowed === true;
  if ((definition?.enchant || bestowing) && destination === "battlefield") {
    // An Aura enters attached to its target; with no legal target left, the
    // spell fizzled and the card goes to the graveyard instead (CR 303.4).
    const target = top.targets[0];
    if (
      definition?.enchant === "player" &&
      target?.type === "player" &&
      hasLegalTargetRemaining(next, requirements, top.targets, top.controllerId, sourceColorsOf(next, top.sourceId), top.sourceId)
    ) {
      // A Curse enters attached to a PLAYER, which is not a card id — the
      // link is set after the permanent arrives, below.
      attachToPlayer = target.playerId;
    } else if (
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
  // Animate Dead: the enchanted card is in a GRAVEYARD, so it is put onto
  // the battlefield under this spell's controller and only then attached.
  // Both happen here, before state-based actions run — a loose Aura is
  // destroyed by one, and an enter trigger would leave exactly that gap.
  if (
    definition?.reanimateOnEnter &&
    attachTo &&
    next.cards[top.sourceId]?.zone === "battlefield" &&
    next.cards[attachTo]?.zone === "graveyard"
  ) {
    next = moveCard(next, attachTo, "battlefield");
    const arrived = next.cards[attachTo];
    if (arrived?.zone === "battlefield") {
      arrived.controllerId = top.controllerId;
      next.cards[top.sourceId]!.reanimatedCardId = attachTo;
    } else {
      // It never arrived, so there is nothing to enchant and the Aura is
      // a loose one. Let the state-based action below take it.
      attachTo = null;
    }
  }
  if (attachTo && next.cards[top.sourceId]?.zone === "battlefield") {
    next.cards[top.sourceId]!.attachedTo = attachTo;
  }
  if (attachToPlayer && next.cards[top.sourceId]?.zone === "battlefield") {
    next.cards[top.sourceId]!.attachedToPlayer = attachToPlayer;
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
