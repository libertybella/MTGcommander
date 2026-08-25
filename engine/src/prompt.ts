import { createId } from "./ids";
import { cloneGameState } from "./clone";
// Deferred call only (decline path) — the effects/prompt import cycle is benign.
import { cardMatchesSubtype, grantedTriggerSpread, triggersOf } from "./characteristicsEngine";
import { characteristicsOf, isCreature, isLand as cardIsLand, isPlaneswalker } from "./cardTypes";
import { applyEffects, bindCardEffects, drawWithoutReplacement, exileUntilTakenStep, grantProtectionUntilEot } from "./effects";
import { payManaCost, tapForMana } from "./mana";
import { manaAbilitiesFor, manaTapOptionsFor } from "./manaOptions";
import { isLiving, requireLiving } from "./players";
import { shuffleInPlace } from "./shuffle";
import { hasAnyLegalTargetSet, validateChosenTargets } from "./targeting";
import { dispatchEventsInPlace, processTriggerGroupsInPlace, queueDefinitionTriggerInPlace } from "./triggers";
import { enterOwnerZoneInPlace, moveCard, moveCardInPlace } from "./zones";
import type {
  BoundChooseCardSource,
  CardEffect,
  CardInstanceId,
  ChosenTarget,
  Color,
  GameState,
  LookDestination,
  ManaColor,
  ManaPool,
  PendingPrompt,
  PlayerId,
  SearchFilter,
} from "./types";

export function currentPrompt(state: GameState): PendingPrompt | null {
  return state.prompts[0] ?? null;
}

export function isPromptOpen(state: GameState): boolean {
  return state.prompts.length > 0;
}

export function dropLostPlayerPromptsInPlace(state: GameState): void {
  state.prompts = state.prompts.filter((prompt) => isLiving(state, prompt.playerId));
}

/**
 * Finish a choose-targets pause. Puts the waiting trigger on the stack with
 * the chosen targets, or skips it if nothing legal remains (CR 603.3d).
 */
export function applyChooseTargets(
  state: GameState,
  playerId: PlayerId,
  targets: ChosenTarget[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_targets") {
    throw new Error("No target choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }

  const next = cloneGameState(state);
  next.prompts.shift();

  if (!hasAnyLegalTargetSet(next, prompt.requirements, playerId)) {
    return next;
  }

  // Deflecting Swat: replace the stack spell's targets in place.
  if (prompt.origin === "retarget" && prompt.stackObjectId) {
    const entry = next.stack.find((object) => object.id === prompt.stackObjectId);
    if (entry && entry.kind === "spell") {
      validateChosenTargets(next, prompt.requirements, targets, entry.controllerId);
      entry.targets = targets.map((target) => ({ ...target }));
    }
    next.passesSinceAction = 0;
    return next;
  }

  validateChosenTargets(next, prompt.requirements, targets, playerId);
  next.stack.push({
    id: createId("stack"),
    controllerId: playerId,
    sourceId: prompt.sourceId,
    kind: "ability",
    targets: targets.map((target) => ({ ...target })),
    triggerIndex: prompt.triggerIndex ?? 0,
    ...grantedTriggerSpread(next, prompt.sourceId, prompt.triggerIndex ?? 0),
    ...(prompt.modeIndex !== undefined ? { modeIndex: prompt.modeIndex } : {}),
    ...(prompt.subjectCardId ? { subjectCardId: prompt.subjectCardId } : {}),
    ...(prompt.subjectPlayerId ? { subjectPlayerId: prompt.subjectPlayerId } : {}),
    ...(prompt.subjectAmount ? { subjectAmount: prompt.subjectAmount } : {}),
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = next.turn.activePlayerId;
  return next;
}

/**
 * Resolve a modal trigger's mode choice: the chosen mode's ability goes on
 * the stack, pausing for its targets first when it has any (skipped with no
 * legal target, CR 603.3d).
 */
export function applyResolveTriggerMode(
  state: GameState,
  playerId: PlayerId,
  chosen: number | number[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_trigger_mode") {
    throw new Error("No trigger mode choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const source = state.cards[prompt.sourceId];
  const trigger = source ? triggersOf(state, prompt.sourceId)[prompt.triggerIndex] : undefined;
  // Absent bounds mean exactly one, which is what every modal trigger
  // written before Black Market Connections asked for.
  const bounds = prompt.modeChoice ?? { min: 1, max: 1 };
  const picked = (Array.isArray(chosen) ? chosen : [chosen]).filter(
    (index, at, all) => all.indexOf(index) === at,
  );
  if (picked.length < bounds.min || picked.length > bounds.max) {
    throw new Error("Wrong number of modes chosen");
  }
  if (picked.some((index) => !trigger?.modes?.[index])) {
    throw new Error("Choose one of the trigger's modes");
  }
  // "…that hasn't been chosen this turn": the memory is on the prompt, so
  // this refuses a repeat without recomputing the key.
  const spent = prompt.spentModes ?? [];
  if (picked.some((index) => spent.includes(index))) {
    throw new Error("That mode was already chosen this turn");
  }
  const modeIndex = picked[0];
  const mode = modeIndex === undefined ? undefined : trigger?.modes?.[modeIndex];
  const next = cloneGameState(state);
  next.prompts.shift();
  // Recorded whether or not the mode resolves into anything: what the card
  // asks is what was CHOSEN, and a mode chosen with no legal target has
  // still been chosen.
  if (trigger?.modesOncePerTurn && picked.length > 0) {
    const key = `${prompt.sourceId}:${prompt.triggerIndex}`;
    const taken = next.modesChosenThisTurn ?? {};
    taken[key] = [...(taken[key] ?? []), ...picked];
    next.modesChosenThisTurn = taken;
  }
  // "Up to one" with none picked: the trigger simply does nothing.
  if (picked.length === 0 || !mode || modeIndex === undefined) {
    next.passesSinceAction = 0;
    if (next.prompts.length === 0) {
      next.priorityPlayerId = next.turn.activePlayerId;
    }
    return next;
  }
  // Several modes at once ride the stack object together; the targeting
  // path below handles the single-mode case it always has.
  const requirements =
    picked.length > 1
      ? picked.flatMap((index) => trigger?.modes?.[index]?.targetRequirements ?? [])
      : mode.targetRequirements ?? [];
  if (requirements.length > 0) {
    if (!hasAnyLegalTargetSet(next, requirements, playerId)) {
      return next;
    }
    next.prompts.unshift({
      kind: "choose_targets",
      playerId,
      sourceId: prompt.sourceId,
      origin: "trigger",
      triggerIndex: prompt.triggerIndex,
      modeIndex,
      requirements: requirements.map((requirement) => ({ ...requirement })),
      ...(prompt.subjectCardId ? { subjectCardId: prompt.subjectCardId } : {}),
      ...(prompt.subjectPlayerId ? { subjectPlayerId: prompt.subjectPlayerId } : {}),
      ...(prompt.subjectAmount ? { subjectAmount: prompt.subjectAmount } : {}),
    });
    return next;
  }
  next.stack.push({
    id: createId("stack"),
    controllerId: playerId,
    sourceId: prompt.sourceId,
    kind: "ability",
    targets: [],
    triggerIndex: prompt.triggerIndex,
    ...grantedTriggerSpread(next, prompt.sourceId, prompt.triggerIndex),
    modeIndex,
    ...(picked.length > 1 ? { modeIndexes: [...picked] } : {}),
    ...(prompt.subjectCardId ? { subjectCardId: prompt.subjectCardId } : {}),
    ...(prompt.subjectPlayerId ? { subjectPlayerId: prompt.subjectPlayerId } : {}),
    ...(prompt.subjectAmount ? { subjectAmount: prompt.subjectAmount } : {}),
  });
  next.passesSinceAction = 0;
  if (next.prompts.length === 0) {
    next.priorityPlayerId = next.turn.activePlayerId;
  }
  return next;
}

/**
 * Finish an APNAP trigger-ordering pause (CR 603.3b): the chooser's triggers
 * go on the stack in the chosen order, then later players' groups continue.
 */
export function applyResolveOrderTriggers(
  state: GameState,
  playerId: PlayerId,
  order: number[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "order_triggers") {
    throw new Error("No trigger ordering pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const expected = prompt.entries.map((_, index) => index);
  if (
    order.length !== expected.length ||
    [...order].sort((a, b) => a - b).some((value, index) => value !== index)
  ) {
    throw new Error("Order every waiting trigger exactly once");
  }

  const next = cloneGameState(state);
  next.prompts.shift();
  for (const index of order) {
    const entry = prompt.entries[index]!;
    queueDefinitionTriggerInPlace(next, entry.cardId, entry.triggerIndex, {
      cardId: entry.subjectCardId,
      playerId: entry.subjectPlayerId,
      amount: entry.subjectAmount,
    });
  }
  processTriggerGroupsInPlace(next, prompt.remaining);
  next.passesSinceAction = 0;
  if (next.prompts.length === 0) {
    next.priorityPlayerId = next.turn.activePlayerId;
  }
  return next;
}

export function applyChooseEnterReplacement(
  state: GameState,
  playerId: PlayerId,
  pay: boolean,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "may_pay_life_or_enter_tapped") {
    throw new Error("No enter replacement pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }

  const next = cloneGameState(state);
  next.prompts.shift();
  const player = next.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  if (pay) {
    player.life -= prompt.amount;
    next.log.push({ kind: "life_change", playerId, delta: -prompt.amount });
  } else {
    const card = next.cards[prompt.sourceId];
    if (card && card.zone === "battlefield") {
      card.tapped = true;
    }
  }
  return next;
}

/**
 * Answer Mox Diamond's as-enters choice. Declining — or having no land to
 * discard — puts the permanent into its owner's graveyard.
 */
export function applyResolveDiscardLandOrGraveyard(
  state: GameState,
  playerId: PlayerId,
  discard: boolean,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "discard_land_or_graveyard") {
    throw new Error("No enter replacement pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  const player = next.players.find((entry) => entry.id === playerId);
  // Cheapest land first — the same auto-pick `discardCost` already uses,
  // and a documented approximation of the free choice.
  const land = discard
    ? (player?.zones.hand ?? [])
        .filter((cardId) => characteristicsOf(next, cardId).types.includes("land"))
        .sort(
          (a, b) =>
            characteristicsOf(next, a).manaValue - characteristicsOf(next, b).manaValue,
        )[0]
    : undefined;
  if (land) {
    next = moveCard(next, land, "graveyard");
    dispatchEventsInPlace(next, [{ kind: "discards", cardId: land, playerId }]);
    return next;
  }
  // No land, or declined: the Mox never stays. Both answers land here, so
  // a player with an empty hand cannot keep it by saying yes.
  const source = next.cards[prompt.sourceId];
  if (source && source.zone === "battlefield") {
    next = moveCard(next, prompt.sourceId, "graveyard");
  }
  return next;
}

/** Answer an as-enters creature-type choice (Kindred Discovery). */
export function applyResolveCreatureType(
  state: GameState,
  playerId: PlayerId,
  creatureType: string,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_creature_type") {
    throw new Error("No creature-type choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const chosen = creatureType.trim().toLowerCase();
  if (!/^[a-z][a-z' -]*$/.test(chosen)) {
    throw new Error("Choose a creature type");
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  const card = next.cards[prompt.sourceId];
  if (card) {
    card.chosenCreatureType = chosen;
    next.log.push({ kind: "creature_type_chosen", cardId: card.id, creatureType: chosen });
    // Banner of Kinship: the enter counters land once the type is known.
    const perType = next.definitions[card.definitionId]?.enterCountersPerChosenType;
    if (perType && card.zone === "battlefield") {
      const count = Object.values(next.cards).filter(
        (entry) =>
          entry.zone === "battlefield" &&
          entry.controllerId === card.controllerId &&
          isCreature(next, entry.id) &&
          cardMatchesSubtype(next, entry.id, chosen),
      ).length;
      if (count > 0) {
        card.counters[perType] = (card.counters[perType] ?? 0) + count;
      }
    }
  }
  return next;
}

/**
 * Tainted Pact, one answer. Taking the card ends the loop; declining takes
 * another turn of it, which may end on the name clash instead.
 *
 * Declining is a real choice and not a formality: the card is played to
 * dig past what you do not want, and auto-taking the first legal card is
 * the whole reason this needed a prompt.
 */
export function applyResolveExileUntilTaken(
  state: GameState,
  playerId: PlayerId,
  take: boolean,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "exile_until_taken") {
    throw new Error("No exile-until choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  if (take) {
    next = moveCard(next, prompt.cardId, "hand");
  } else {
    next = exileUntilTakenStep(next, playerId, prompt.exiledThisWay);
  }
  const resume = prompt.resumeEffects;
  if (resume && resume.length > 0 && next.prompts.length === 0) {
    next = applyEffects(next, resume);
  } else if (resume && resume.length > 0) {
    // The loop is still going, so the rest of the card rides the prompt it
    // just made rather than running between two turns of it.
    const pending = next.prompts[next.prompts.length - 1];
    if (pending && pending.kind === "exile_until_taken") {
      pending.resumeEffects = resume;
    }
  }
  return next;
}

/**
 * The punisher choice. An opponent picks which branch happens, and both
 * are real: the taken one and the declined one are equally the card, so
 * neither is auto-taken by its controller.
 *
 * The branches bind HERE, with the chooser as the subject player — "deals
 * damage to that player" means the one who just refused.
 */
export function applyResolvePunisher(
  state: GameState,
  playerId: PlayerId,
  take: boolean,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "punisher_choice") {
    throw new Error("No punisher choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  const branch = take ? prompt.ifTaken : prompt.ifDeclined;
  if (branch.length > 0) {
    next = applyEffects(
      next,
      bindCardEffects(next, branch, {
        controllerId: prompt.controllerId,
        sourceId: prompt.sourceId,
        subjectPlayerId: playerId,
        targets: [],
        targetRequirements: [],
      }),
    );
  }
  const resume = prompt.resumeEffects;
  if (resume && resume.length > 0) {
    next = applyEffects(next, resume);
  }
  return next;
}

/**
 * Dredge (CR 702.52). Answering with no card takes the draw; answering
 * with one mills that card's dredge number and returns it to hand INSTEAD
 * of drawing.
 *
 * The draws still owed are re-issued afterwards rather than run here, so a
 * second dredge is offered for the second card of a Divination.
 */
export function applyResolveDredge(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId | null,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "replace_draw_with_dredge") {
    throw new Error("No dredge choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  if (cardId !== null && !prompt.cardIds.includes(cardId)) {
    throw new Error("That card cannot be dredged");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  if (cardId === null) {
    // NOT through the draw effect: that offers the replacement again, and
    // a player who just declined it would be asked for ever.
    next = drawWithoutReplacement(next, playerId, 1, prompt.turnDraw);
  } else {
    const dredge = next.definitions[next.cards[cardId]?.definitionId ?? ""]?.dredge ?? 0;
    next = applyEffects(next, [{ kind: "mill", playerId, count: dredge }]);
    next = moveCard(next, cardId, "hand");
  }
  if (prompt.remaining > 0) {
    // Re-issued rather than looped: this goes back through the draw effect,
    // which offers the replacement again for the next card.
    next = applyEffects(next, [{ kind: "draw", playerId, count: prompt.remaining }]);
  }
  const resume = prompt.resumeEffects;
  if (resume && resume.length > 0) {
    next = applyEffects(next, resume);
  }
  return next;
}

/**
 * Myr Battlesphere: which of your untapped Myr to tap. The SIZE of the
 * answer is the X the rider reads, so the rider is bound here — after the
 * choice — rather than in the batch that offered it.
 *
 * Choosing none is legal: "you MAY tap X", and X is then zero, so the
 * rider is skipped entirely rather than run for nothing.
 */
export function applyResolveTapOwnForX(
  state: GameState,
  playerId: PlayerId,
  cardIds: CardInstanceId[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "tap_own_for_x") {
    throw new Error("No tap choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const offered = new Set(prompt.cardIds);
  const seen = new Set<CardInstanceId>();
  for (const cardId of cardIds) {
    if (!offered.has(cardId) || seen.has(cardId)) {
      throw new Error("That permanent is not one of the ones offered");
    }
    seen.add(cardId);
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  for (const cardId of cardIds) {
    const card = next.cards[cardId];
    if (card && card.zone === "battlefield") {
      card.tapped = true;
    }
  }
  if (cardIds.length > 0) {
    next = applyEffects(
      next,
      bindCardEffects(next, prompt.rider, {
        controllerId: playerId,
        sourceId: prompt.sourceId,
        xValue: cardIds.length,
        targets: [],
        targetRequirements: [],
      }),
    );
  }
  const resume = prompt.resumeEffects;
  if (resume && resume.length > 0) {
    next = applyEffects(next, resume);
  }
  return next;
}

/**
 * One opponent's answer to a tempting offer. Accepting applies the action
 * bound to THEM, then the chain moves to the next opponent; when the last
 * has answered, the controller repeats their action once per acceptance.
 *
 * The continuation prompt is queued AFTER whatever the acceptance pushed —
 * Tempt with Discovery's search opens a prompt of its own, and it has to be
 * answered before the next opponent is asked. Prompts are first-in first-
 * out, so appending is what puts them in that order.
 */
export function applyResolveTemptingOffer(
  state: GameState,
  playerId: PlayerId,
  accept: boolean,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "tempting_offer") {
    throw new Error("No tempting offer pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  if (accept) {
    next = applyEffects(
      next,
      bindCardEffects(next, prompt.action, {
        controllerId: playerId,
        sourceId: null,
        targets: [],
        targetRequirements: [],
      }),
    );
  }
  const accepted = prompt.accepted + (accept ? 1 : 0);
  const nextOpponent = prompt.remaining[0];
  if (nextOpponent) {
    next = cloneGameState(next);
    next.prompts.push({
      kind: "tempting_offer",
      playerId: nextOpponent,
      controllerId: prompt.controllerId,
      remaining: prompt.remaining.slice(1),
      accepted,
      action: prompt.action.map((one) => ({ ...one })),
      ...(prompt.resumeEffects ? { resumeEffects: prompt.resumeEffects } : {}),
    });
    return next;
  }
  // Every repeat in ONE list rather than a loop: the parking-and-resuming
  // in applyEffects then handles an action that opens a prompt each time,
  // which a loop would silently stack on top of an unanswered one.
  const repeats: CardEffect[] = [];
  for (let index = 0; index < accepted; index += 1) {
    repeats.push(...prompt.action.map((one) => ({ ...one })));
  }
  if (repeats.length > 0) {
    next = applyEffects(
      next,
      bindCardEffects(next, repeats, {
        controllerId: prompt.controllerId,
        sourceId: null,
        targets: [],
        targetRequirements: [],
      }),
    );
  }
  const resume = prompt.resumeEffects;
  if (resume && resume.length > 0) {
    next = applyEffects(next, resume);
  }
  return next;
}

/**
 * The divider's answer: which of the revealed cards form the FIRST pile.
 * Everything else is the second. Either pile may be empty — "separates
 * them into two piles" permits it, and an empty pile is the whole bluff on
 * a Fact or Fiction that revealed one card worth having.
 *
 * This prompt belongs to an OPPONENT of the ability's controller, and the
 * one it queues belongs back to the controller. That handoff is the card.
 */
export function applyResolveDividePiles(
  state: GameState,
  playerId: PlayerId,
  cardIds: CardInstanceId[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "divide_piles") {
    throw new Error("No pile division pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const revealed = new Set(prompt.cardIds);
  const first: CardInstanceId[] = [];
  const seen = new Set<CardInstanceId>();
  for (const cardId of cardIds) {
    if (!revealed.has(cardId)) {
      throw new Error("That card was not revealed");
    }
    if (seen.has(cardId)) {
      throw new Error("That card is already in a pile");
    }
    seen.add(cardId);
    first.push(cardId);
  }
  const second = prompt.cardIds.filter((cardId) => !seen.has(cardId));
  const next = cloneGameState(state);
  next.prompts.shift();
  next.prompts.unshift({
    kind: "choose_pile",
    playerId: prompt.chooserId,
    first,
    second,
    taken: prompt.taken,
    left: prompt.left,
    ...(prompt.resumeEffects ? { resumeEffects: prompt.resumeEffects } : {}),
  });
  return next;
}

/** The controller's answer: take the first pile, or the second. */
export function applyResolveChoosePile(
  state: GameState,
  playerId: PlayerId,
  takeFirst: boolean,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_pile") {
    throw new Error("No pile choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  const taken = takeFirst ? prompt.first : prompt.second;
  const left = takeFirst ? prompt.second : prompt.first;
  // The taken pile first, so a card in both lists could never be moved
  // twice — the divider cannot put one there, and this makes it not matter.
  for (const cardId of taken) {
    moveCardInPlace(next, cardId, prompt.taken);
  }
  for (const cardId of left) {
    moveCardInPlace(next, cardId, prompt.left);
  }
  const resume = prompt.resumeEffects;
  if (resume && resume.length > 0) {
    next = applyEffects(next, resume);
  }
  return next;
}

/**
 * Answer a "choose a card name" prompt. ANY name is legal, including one
 * that appears nowhere in the game: naming a card you do not own is how
 * Demonic Consultation exiles its controller's whole library, and offering
 * only findable names would delete the line the card is played for.
 *
 * The name goes on the STATE, because the effects that read it were bound
 * before the prompt existed — `applyEffects` parks them here and resumes
 * them, so they read the name at apply.
 */
export function applyResolveCardName(
  state: GameState,
  playerId: PlayerId,
  cardName: string,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_card_name") {
    throw new Error("No card-name choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const chosen = cardName.trim();
  if (chosen.length === 0) {
    throw new Error("Choose a card name");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  next.lastChosenCardName = chosen;
  // Gideon's Intervention: the name is remembered on the permanent, where a
  // static ability can keep reading it for as long as it is on the field.
  const source = prompt.sourceId ? next.cards[prompt.sourceId] : undefined;
  if (source) {
    source.chosenCardName = chosen;
  }
  const resume = prompt.resumeEffects;
  if (resume && resume.length > 0) {
    next = applyEffects(next, resume);
  }
  return next;
}

/** Answer an as-enters color choice (Utopia Sprawl). */
export function applyResolveColor(
  state: GameState,
  playerId: PlayerId,
  color: Color,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_color") {
    throw new Error("No color choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  if (!["W", "U", "B", "R", "G"].includes(color)) {
    throw new Error("Choose a color");
  }
  // Thriving lands: the land's own colour is not on offer.
  if (prompt.excludeColor && color === prompt.excludeColor) {
    throw new Error("Choose a different color");
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  // Mother of Runes: the answer becomes an until-EOT protection grant.
  if (prompt.grantProtectionTo) {
    return next.cards[prompt.grantProtectionTo]?.zone === "battlefield"
      ? grantProtectionUntilEot(next, prompt.grantProtectionTo, color)
      : next;
  }
  const card = next.cards[prompt.sourceId];
  if (card) {
    card.chosenColor = color;
  }
  return next;
}

export function applyResolveScry(
  state: GameState,
  playerId: PlayerId,
  bottomIds: CardInstanceId[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "scry") {
    throw new Error("No scry pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }

  const next = cloneGameState(state);
  next.prompts.shift();
  const player = next.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  const looked = player.zones.library.slice(0, prompt.count);
  const lookedSet = new Set(looked);
  for (const cardId of bottomIds) {
    if (!lookedSet.has(cardId)) {
      throw new Error("Can only put looked-at cards on the bottom");
    }
  }
  const keep = looked.filter((cardId) => !bottomIds.includes(cardId));
  const rest = player.zones.library.slice(prompt.count);
  player.zones.library = [...keep, ...rest, ...bottomIds];
  return next;
}

export function lookedAtCardIds(state: GameState, prompt: PendingPrompt): CardInstanceId[] {
  if (prompt.kind !== "scry" && prompt.kind !== "surveil" && prompt.kind !== "look_and_assign") {
    return [];
  }
  const player = state.players.find((entry) => entry.id === prompt.playerId);
  return player?.zones.library.slice(0, prompt.count) ?? [];
}

export function applyResolveSurveil(
  state: GameState,
  playerId: PlayerId,
  graveyardIds: CardInstanceId[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "surveil") {
    throw new Error("No surveil pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }

  const next = cloneGameState(state);
  next.prompts.shift();
  const player = next.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  const looked = player.zones.library.slice(0, prompt.count);
  const lookedSet = new Set(looked);
  for (const cardId of graveyardIds) {
    if (!lookedSet.has(cardId)) {
      throw new Error("Can only put looked-at cards into the graveyard");
    }
  }
  let moved = next;
  for (const cardId of graveyardIds) {
    moved = moveCard(moved, cardId, "graveyard");
  }
  return moved;
}

function cardMatchesFilter(
  state: GameState,
  cardId: CardInstanceId,
  filter: BoundChooseCardSource["filter"],
): boolean {
  if (filter === "any") {
    return true;
  }
  const card = state.cards[cardId];
  const types = card ? state.definitions[card.definitionId]?.characteristics.types ?? [] : [];
  if (filter === "noncreature_nonland") {
    return !types.includes("land") && !types.includes("creature");
  }
  if (filter === "nonartifact_nonland") {
    return !types.includes("land") && !types.includes("artifact");
  }
  if (filter === "permanent") {
    // CR 110.4a: the permanent card types. Instants and sorceries are the
    // only things this excludes, but naming what IS one keeps a future
    // card type (battle already landed once) from silently qualifying.
    return ["creature", "artifact", "enchantment", "land", "planeswalker", "battle"].some(
      (type) => types.includes(type),
    );
  }
  if (filter === "enchantment" || filter === "battle") {
    return types.includes(filter);
  }
  if (filter === "land") {
    return types.includes("land");
  }
  if (filter === "creature") {
    return types.includes("creature");
  }
  if (filter === "nontoken_creature") {
    return types.includes("creature") && !card?.isToken;
  }
  if (filter === "token_creature") {
    return types.includes("creature") && card?.isToken === true;
  }
  if (filter === "planeswalker") {
    return types.includes("planeswalker");
  }
  if (filter === "artifact") {
    return types.includes("artifact");
  }
  if (filter === "equipment") {
    return cardMatchesSubtype(state, cardId, "equipment");
  }
  if (filter === "basic_land") {
    const traits = card ? state.definitions[card.definitionId]?.characteristics : undefined;
    return types.includes("land") && (traits?.supertypes ?? []).includes("basic");
  }
  // Plaguecrafter: "a creature or planeswalker of their choice".
  if (filter === "creature_or_planeswalker") {
    return types.includes("creature") || types.includes("planeswalker");
  }
  return !types.includes("land");
}

/**
 * The cards tied for the highest mana value in the given set. Ties all
 * survive: the printed card says "the greatest mana value", and two 6-drops
 * are both permanents with the greatest mana value, so the chooser picks
 * between them.
 */
function greatestManaValueOf(
  state: GameState,
  cardIds: CardInstanceId[],
): CardInstanceId[] {
  const manaValueOfCard = (cardId: CardInstanceId): number =>
    state.definitions[state.cards[cardId]?.definitionId ?? ""]?.characteristics.manaValue ?? 0;
  let greatest = -1;
  for (const cardId of cardIds) {
    greatest = Math.max(greatest, manaValueOfCard(cardId));
  }
  return cardIds.filter((cardId) => manaValueOfCard(cardId) === greatest);
}

export function legalIdsForChooseSources(
  state: GameState,
  sources: BoundChooseCardSource[],
): CardInstanceId[] {
  const ids: CardInstanceId[] = [];
  const seen = new Set<CardInstanceId>();
  for (const source of sources) {
    const player = state.players.find((entry) => entry.id === source.playerId);
    const matching: CardInstanceId[] = [];
    for (const cardId of player?.zones[source.zone] ?? []) {
      if (
        seen.has(cardId) ||
        cardId === source.excludeCardId ||
        !cardMatchesFilter(state, cardId, source.filter)
      ) {
        continue;
      }
      // Braids: the permanent must share a CARD TYPE with the one just
      // sacrificed — a land answers a land, a creature a creature.
      if (source.sharesTypes) {
        const mine = characteristicsOf(state, cardId).types;
        if (!source.sharesTypes.some((type) => mine.includes(type))) {
          continue;
        }
      }
      // Dauthi Voidwalker: only the exiled cards its own replacement put
      // there. Every other card in that exile is somebody else's business.
      if (source.hasVoidCounter && (state.cards[cardId]?.counters["void"] ?? 0) === 0) {
        continue;
      }
      // Sylvan Library: "cards in your hand drawn this turn". A card held
      // since last turn is a better card to put back, and offering it would
      // make the drawback a bonus.
      if (
        source.drawnThisTurn &&
        state.cards[cardId]?.drawnOnTurn !== state.turn.number
      ) {
        continue;
      }
      // "…from among them": the cards this mill made, and nothing else in
      // a graveyard that may already have held a hundred of them.
      if (source.milledThisWay && !(state.lastMilledCardIds ?? []).includes(cardId)) {
        continue;
      }
      // Kodama: "with equal or lesser mana value". A cap the caller can
      // ignore is not a cap.
      if (
        source.maxManaValue !== undefined &&
        characteristicsOf(state, cardId).manaValue > source.maxManaValue
      ) {
        continue;
      }
      matching.push(cardId);
    }
    // Soul Shatter: the choice is restricted to the cards tied for the
    // highest mana value. Narrowed WITHIN this source, so each opponent
    // measures their own board — a table-wide maximum would let the
    // player with the small board off entirely.
    const offered = source.greatestManaValue ? greatestManaValueOf(state, matching) : matching;
    for (const cardId of offered) {
      if (seen.has(cardId)) {
        continue;
      }
      seen.add(cardId);
      ids.push(cardId);
    }
  }
  return ids;
}

export function applyResolveDiscard(
  state: GameState,
  playerId: PlayerId,
  cardIds: CardInstanceId[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_discard") {
    throw new Error("No discard pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  if (cardIds.length !== prompt.count) {
    throw new Error(`Choose ${prompt.count} card(s) to discard`);
  }
  const player = state.players.find((entry) => entry.id === playerId);
  const hand = new Set(player?.zones.hand ?? []);
  for (const cardId of cardIds) {
    if (!hand.has(cardId)) {
      throw new Error("Can only discard cards from hand");
    }
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  let moved = next;
  for (const cardId of cardIds) {
    moved = moveCard(moved, cardId, "graveyard");
    dispatchEventsInPlace(moved, [{ kind: "discards", cardId, playerId }]);
  }
  return moved;
}

/**
 * "Put any number of cards from your hand …" — Valakut Awakening and Last
 * March of the Ents. An EMPTY choice is legal and is the reason this is not
 * `choose_discard` with a count: there is no number to satisfy, and Valakut
 * choosing nothing still draws its plus-one.
 */
export function applyResolveChooseFromHand(
  state: GameState,
  playerId: PlayerId,
  cardIds: CardInstanceId[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_from_hand") {
    throw new Error("No hand choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const player = state.players.find((entry) => entry.id === playerId);
  const hand = new Set(player?.zones.hand ?? []);
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error("Cannot choose the same card twice");
  }
  for (const cardId of cardIds) {
    if (!hand.has(cardId)) {
      throw new Error("Can only choose cards from hand");
    }
    // Last March: "any number of CREATURE cards". A filter the caller can
    // ignore is not a filter.
    if (
      prompt.types &&
      !prompt.types.every((type) => characteristicsOf(state, cardId).types.includes(type))
    ) {
      throw new Error("That card is not a legal choice");
    }
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  for (const cardId of cardIds) {
    next =
      prompt.destination === "battlefield"
        ? moveCard(next, cardId, "battlefield")
        : moveCard(next, cardId, "library", { libraryPosition: "bottom" });
  }
  if (prompt.thenDrawPlus !== undefined) {
    // "Draw THAT MANY cards plus one" — that many is what was just chosen,
    // which is why the draw lives here rather than in a sibling effect that
    // would have bound its count before the choice was made.
    next = applyEffects(next, [
      { kind: "draw", playerId, count: cardIds.length + prompt.thenDrawPlus },
    ]);
  }
  return next;
}

export function applyResolveChooseCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId | null,
): {
  next: GameState;
  thenEffects: CardEffect[];
  sourceId: CardInstanceId | null;
  cardId: CardInstanceId | null;
  controllerId?: PlayerId;
  declined?: boolean;
} {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_card") {
    throw new Error("No card choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  if (cardId === null) {
    // Braids: declining is a real answer, and the punisher is what makes
    // it one. A choice that is not optional still has to be answered.
    if (!prompt.optional) {
      throw new Error("That choice cannot be declined");
    }
    const declinedNext = cloneGameState(state);
    declinedNext.prompts.shift();
    declinedNext.reveals = declinedNext.reveals.filter(
      (entry) => entry.viewerId !== playerId,
    );
    return {
      next: declinedNext,
      thenEffects: prompt.thenEffectsIfNone ?? [],
      sourceId: prompt.sourceId,
      cardId: null,
      ...(prompt.controllerId ? { controllerId: prompt.controllerId } : {}),
      declined: true,
    };
  }
  const legal = new Set(legalIdsForChooseSources(state, prompt.sources));
  if (!legal.has(cardId)) {
    throw new Error("That card is not a legal choice");
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  next.reveals = next.reveals.filter((entry) => entry.viewerId !== playerId);
  return {
    next,
    thenEffects: prompt.thenEffects,
    sourceId: prompt.sourceId,
    cardId,
    ...(prompt.controllerId ? { controllerId: prompt.controllerId } : {}),
  };
}

/** Battlefield cards a pending enter_as_copy prompt may legally copy. */
export function legalEnterCopyIds(
  state: GameState,
  prompt: Extract<PendingPrompt, { kind: "enter_as_copy" }>,
): CardInstanceId[] {
  const ids: CardInstanceId[] = [];
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.id === prompt.sourceId) {
      continue;
    }
    if (
      prompt.maxManaValue !== undefined &&
      (state.definitions[card.definitionId]?.characteristics.manaValue ?? 0) > prompt.maxManaValue
    ) {
      continue;
    }
    const mine = card.controllerId === prompt.playerId;
    switch (prompt.scope) {
      case "any_creature":
        if (isCreature(state, card.id)) {
          ids.push(card.id);
        }
        break;
      case "your_creature":
      case "another_your_creature":
        // "another" only excludes the entering card itself, filtered above.
        if (mine && isCreature(state, card.id)) {
          ids.push(card.id);
        }
        break;
      case "your_creature_or_planeswalker":
        if (mine && (isCreature(state, card.id) || isPlaneswalker(state, card.id))) {
          ids.push(card.id);
        }
        break;
      case "any_nonland_permanent":
        if (!cardIsLand(state, card.id)) {
          ids.push(card.id);
        }
        break;
      case "any_artifact_or_creature":
        if (
          isCreature(state, card.id) ||
          characteristicsOf(state, card.id).types.includes("artifact")
        ) {
          ids.push(card.id);
        }
        break;
      // Sculpting Steel.
      case "any_artifact":
        if (characteristicsOf(state, card.id).types.includes("artifact")) {
          ids.push(card.id);
        }
        break;
      // Vesuva.
      case "any_land":
        if (characteristicsOf(state, card.id).types.includes("land")) {
          ids.push(card.id);
        }
        break;
      // Masterwork of Ingenuity.
      case "any_equipment":
        if (cardMatchesSubtype(state, card.id, "equipment")) {
          ids.push(card.id);
        }
        break;
      // Mirrormade.
      case "any_artifact_or_enchantment": {
        const types = characteristicsOf(state, card.id).types;
        if (types.includes("artifact") || types.includes("enchantment")) {
          ids.push(card.id);
        }
        break;
      }
    }
  }
  return ids;
}

/**
 * Resolve a Clone-style enter prompt: point the entered card at the chosen
 * permanent's current definition (copiable values ≈ the definition — a
 * documented approximation), or decline with null to keep it as itself.
 * The copied definition's enter-the-battlefield triggers fire on copy.
 */
export function applyResolveEnterCopy(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId | null,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "enter_as_copy") {
    throw new Error("No copy choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  if (cardId === null) {
    return next;
  }
  if (!legalEnterCopyIds(state, prompt).includes(cardId)) {
    throw new Error("That permanent is not a legal copy choice");
  }
  const entered = next.cards[prompt.sourceId];
  const original = next.cards[cardId];
  if (!entered || entered.zone !== "battlefield" || !original) {
    return next;
  }
  // Cursed Mirror: record what to put back BEFORE the swap, so the card
  // that returns at end of turn is the printed one and not the copy.
  if (prompt.untilEot) {
    const pending = next.temporaryCopies ?? [];
    if (!pending.some((entry) => entry.cardId === entered.id)) {
      pending.push({ cardId: entered.id, restoreDefinitionId: entered.definitionId });
    }
    next.temporaryCopies = pending;
  }
  let copiedId = original.definitionId;
  if (prompt.grantHaste) {
    // "Except it has haste" is not cosmetic on a card whose whole point is
    // attacking the turn it arrives. A fresh definition, so every other
    // copy of the same creature stays hasteless.
    const source = next.definitions[copiedId];
    if (source && !source.keywords.includes("haste")) {
      const hasted = JSON.parse(JSON.stringify(source)) as typeof source;
      hasted.id = createId("definition");
      hasted.keywords = [...hasted.keywords, "haste"];
      next.definitions[hasted.id] = hasted;
      copiedId = hasted.id;
    }
  }
  entered.definitionId = copiedId;
  // Vesuva: the copy arrives tapped regardless of what it copied.
  if (prompt.entersTapped) {
    entered.tapped = true;
  }
  if (prompt.extraCounters && isCreature(next, entered.id)) {
    entered.counters["p1p1"] = (entered.counters["p1p1"] ?? 0) + prompt.extraCounters;
  }
  // The copy "enters as" the chosen card, so its own enter-the-battlefield
  // triggers fire — but only its own: the permanent already dispatched a
  // global "enters" event when it hit the battlefield as itself, so firing
  // watchers (Soul Warden and friends) again would double-count it.
  const copiedTriggers = next.definitions[entered.definitionId]?.triggers ?? [];
  for (let index = 0; index < copiedTriggers.length; index += 1) {
    const trigger = copiedTriggers[index];
    if (trigger?.event === "enter_battlefield" && (trigger.watch ?? "self") === "self") {
      queueDefinitionTriggerInPlace(next, entered.id, index, { cardId: entered.id });
    }
  }
  return next;
}

export function searchMatches(
  state: GameState,
  cardId: CardInstanceId,
  filter: SearchFilter,
): boolean {
  const card = state.cards[cardId];
  const traits = card ? state.definitions[card.definitionId]?.characteristics : undefined;
  if (!traits) {
    return false;
  }
  // Urza's Saga: the printed COST, not the mana value. A {W} artifact has
  // mana value 1 and is not an artifact with mana cost {1}.
  const printedCost = state.definitions[card?.definitionId ?? ""]?.manaCost ?? "";
  if (filter.manaCostIn && !filter.manaCostIn.includes(printedCost)) {
    return false;
  }
  for (const supertype of filter.supertypes ?? []) {
    if (!traits.supertypes.includes(supertype)) {
      return false;
    }
  }
  for (const type of filter.types ?? []) {
    if (!traits.types.includes(type)) {
      return false;
    }
  }
  for (const subtype of filter.subtypes ?? []) {
    if (!cardMatchesSubtype(state, cardId, subtype)) {
      return false;
    }
  }
  if (
    filter.subtypesAny &&
    filter.subtypesAny.length > 0 &&
    !filter.subtypesAny.some((subtype) => cardMatchesSubtype(state, cardId, subtype))
  ) {
    return false;
  }
  for (const color of filter.colors ?? []) {
    if (!traits.colors.includes(color)) {
      return false;
    }
  }
  for (const type of filter.nonTypes ?? []) {
    if (traits.types.includes(type)) {
      return false;
    }
  }
  for (const subtype of filter.nonSubtypes ?? []) {
    if (cardMatchesSubtype(state, cardId, subtype)) {
      return false;
    }
  }
  if (filter.maxManaValue !== undefined && traits.manaValue > filter.maxManaValue) {
    return false;
  }
  // Printed keywords: a card in the library is not on the battlefield, so
  // the layer engine has nothing to say about it.
  if (
    filter.keyword !== undefined &&
    !(state.definitions[card.definitionId]?.keywords ?? []).includes(filter.keyword)
  ) {
    return false;
  }
  // The disjunction is checked LAST, so the fields beside it have already
  // narrowed the card — they qualify every branch rather than competing
  // with them. A branch is an ordinary filter, matched by this same
  // function; nothing builds a branch carrying its own `anyOf`.
  if (
    filter.anyOf &&
    filter.anyOf.length > 0 &&
    !filter.anyOf.some((branch) => searchMatches(state, cardId, branch))
  ) {
    return false;
  }
  // Transmute: "with the same mana value as this card".
  if (filter.exactManaValue !== undefined && traits.manaValue !== filter.exactManaValue) {
    return false;
  }
  // Recruiter of the Guard: printed toughness cap.
  if (filter.maxToughness !== undefined) {
    const toughness = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.toughness ?? 0;
    if ((toughness ?? 0) > filter.maxToughness) {
      return false;
    }
  }
  // Imperial Recruiter: printed power cap.
  if (filter.maxPower !== undefined) {
    const power = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.power ?? 0;
    if ((power ?? 0) > filter.maxPower) {
      return false;
    }
  }
  if (
    filter.typesAny &&
    filter.typesAny.length > 0 &&
    !filter.typesAny.some((type) => traits.types.includes(type))
  ) {
    return false;
  }
  return true;
}

/** Library cards a pending search may fetch. */
export function legalSearchIds(state: GameState, prompt: PendingPrompt): CardInstanceId[] {
  if (prompt.kind !== "search_library") {
    return [];
  }
  const player = state.players.find((entry) => entry.id === prompt.playerId);
  // Finale of Devastation: "your library AND/OR graveyard" is one pool the
  // search picks from, so both zones are offered together.
  const pool = [
    ...(player?.zones.library ?? []),
    ...(prompt.alsoGraveyard ? (player?.zones.graveyard ?? []) : []),
  ];
  return pool.filter((cardId) => searchMatches(state, cardId, prompt.filter));
}

/**
 * Finish a library search: chosen cards go to the destination (failing to
 * find is legal — zero cards), then the library shuffles (CR 701.19).
 */
export function applyResolveSearch(
  state: GameState,
  playerId: PlayerId,
  cardIds: CardInstanceId[],
  random: () => number = Math.random,
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "search_library") {
    throw new Error("No search pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  if (cardIds.length > prompt.count) {
    throw new Error(`Choose at most ${prompt.count} card(s)`);
  }
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error("Choose each card once");
  }
  const legal = new Set(legalSearchIds(state, prompt));
  // "If you search your LIBRARY this way, shuffle." Which zone the card
  // came from has to be read before it moves.
  const fromGraveyard = new Set(
    state.players.find((entry) => entry.id === playerId)?.zones.graveyard ?? [],
  );
  const tookFromLibraryOnly =
    !prompt.alsoGraveyard ||
    cardIds.length === 0 ||
    cardIds.some((cardId) => !fromGraveyard.has(cardId));
  for (const cardId of cardIds) {
    if (!legal.has(cardId)) {
      throw new Error("That card does not match the search");
    }
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  if (prompt.destination === "library_top") {
    // Vampiric Tutor: shuffle the rest, then the chosen card goes on top.
    const player = next.players.find((entry) => entry.id === playerId);
    if (player) {
      player.zones.library = player.zones.library.filter((id) => !cardIds.includes(id));
      shuffleInPlace(player.zones.library, random);
      player.zones.library = [...cardIds, ...player.zones.library];
    }
    dispatchEventsInPlace(next, [{ kind: "searches_library", playerId }]);
    return next;
  }
  for (const cardId of cardIds) {
    // Archdruid's Charm: a LAND found this way goes to the battlefield
    // tapped and everything else goes to hand, so the destination is
    // decided per card rather than once for the search.
    const asLand =
      prompt.landsToBattlefieldTapped === true && cardIsLand(next, cardId);
    next = moveCard(next, cardId, asLand ? "battlefield" : prompt.destination);
    if (asLand) {
      const fetched = next.cards[cardId];
      if (fetched && fetched.zone === "battlefield") {
        fetched.tapped = true;
      }
      continue;
    }
    if (prompt.destination === "battlefield" && prompt.entersTapped) {
      const fetched = next.cards[cardId];
      if (fetched && fetched.zone === "battlefield") {
        fetched.tapped = true;
        // Fabled Passage: the fetched land untaps at the land threshold.
        if (prompt.untapIfLands !== undefined) {
          const lands = Object.values(next.cards).filter(
            (card) =>
              card.zone === "battlefield" &&
              card.controllerId === playerId &&
              cardIsLand(next, card.id),
          ).length;
          if (lands >= prompt.untapIfLands) {
            fetched.tapped = false;
          }
        }
      }
    }
  }
  const player = next.players.find((entry) => entry.id === playerId);
  // Taking the card from the graveyard alone means the library was never
  // searched, so it is not shuffled. Finding nothing still shuffles: you
  // looked. A documented reading — the engine cannot know whether a player
  // who took a graveyard card also looked at their library.
  if (player && tookFromLibraryOnly) {
    shuffleInPlace(player.zones.library, random);
  }
  dispatchEventsInPlace(next, [{ kind: "searches_library", playerId }]);
  return next;
}

/**
 * Answer a pay-or-be-countered prompt (Spell Pierce, ward). Paying may tap
 * listed mana producers first — activating mana abilities is legal while a
 * payment is due (CR 601.2g). Declining counters the spell.
 */
export function applyResolvePay(
  state: GameState,
  playerId: PlayerId,
  pay: boolean,
  taps: { cardId: CardInstanceId; color?: ManaColor; manaIndex?: number }[] = [],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || (prompt.kind !== "pay_or_counter" && prompt.kind !== "pay_or_effect")) {
    throw new Error("No payment pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  if (!pay) {
    if (prompt.kind === "pay_or_effect") {
      return prompt.whenPaid ? next : applyEffects(next, prompt.thenEffects);
    }
    const index = next.stack.findIndex((entry) => entry.id === prompt.stackObjectId);
    if (index !== -1) {
      const [removed] = next.stack.splice(index, 1);
      // A countered copy ceases to exist; its source card belongs to the
      // original spell (CR 707.10a). A flashbacked card exiles (CR 702.34a).
      if (!removed?.isCopy && removed?.sourceId && next.cards[removed.sourceId]?.zone === "stack") {
        enterOwnerZoneInPlace(next, removed.sourceId, removed.fromGraveyard ? "exile" : "graveyard");
      }
    }
    return next;
  }
  for (const tap of taps) {
    const card = next.cards[tap.cardId];
    if (!card || card.controllerId !== playerId || card.zone !== "battlefield" || card.tapped) {
      throw new Error("Cannot tap that permanent for mana");
    }
    const abilities = manaAbilitiesFor(next, tap.cardId);
    const ability = abilities[tap.manaIndex ?? 0];
    if (!ability) {
      throw new Error("That permanent does not produce mana");
    }
    const options = manaTapOptionsFor(ability);
    let addition: Partial<ManaPool>;
    if (options) {
      if (!tap.color || !options.includes(tap.color)) {
        throw new Error("Choose a mana color");
      }
      addition = { [tap.color]: 1 };
    } else {
      addition = ability.produces;
    }
    next = tapForMana(next, tap.cardId, addition);
  }
  // Both halves, not one or the other: Ripples of Undeath asks for "{1} and
  // 3 life", and Sylvan Library asks for life with an empty mana cost.
  if (prompt.cost !== "") {
    next = payManaCost(next, playerId, prompt.cost);
  }
  if (prompt.life !== undefined) {
    // Paid from life, not mana. Declining is the other branch, so a player
    // who cannot afford it must take that instead.
    const payer = next.players.find((entry) => entry.id === playerId);
    if (!payer || payer.life < prompt.life) {
      throw new Error("Not enough life to pay");
    }
    payer.life -= prompt.life;
    dispatchEventsInPlace(next, [
      { kind: "loses_life", playerId, amount: prompt.life },
    ]);
  }
  if (prompt.kind === "pay_or_effect" && prompt.whenPaid) {
    next = applyEffects(next, prompt.thenEffects);
  }
  return next;
}

export function applyResolveLookAssign(
  state: GameState,
  playerId: PlayerId,
  assignments: { cardId: CardInstanceId; destination: LookDestination }[],
): GameState {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "look_and_assign") {
    throw new Error("No look pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const looked = lookedAtCardIds(state, prompt);
  if (assignments.length !== looked.length) {
    throw new Error("Assign every looked-at card");
  }
  const lookedSet = new Set(looked);
  // Destinations are a multiset: Impulse offers one hand slot and several
  // library-bottom slots.
  const capacity = new Map<LookDestination, number>();
  for (const destination of prompt.destinations) {
    capacity.set(destination, (capacity.get(destination) ?? 0) + 1);
  }
  const usedCard = new Set<CardInstanceId>();
  for (const assignment of assignments) {
    if (!lookedSet.has(assignment.cardId) || usedCard.has(assignment.cardId)) {
      throw new Error("Can only assign each looked-at card once");
    }
    const remaining = capacity.get(assignment.destination) ?? 0;
    if (remaining <= 0) {
      throw new Error("Each destination slot can be used once");
    }
    capacity.set(assignment.destination, remaining - 1);
    usedCard.add(assignment.cardId);
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  let moved = next;
  for (const assignment of assignments) {
    if (assignment.destination === "hand") {
      moved = moveCard(moved, assignment.cardId, "hand");
    } else if (assignment.destination === "library_bottom") {
      moved = moveCard(moved, assignment.cardId, "library", { libraryPosition: "bottom" });
    } else if (assignment.destination === "library_top") {
      // Sensei's Top reorder: later assignments land above earlier ones.
      moved = moveCard(moved, assignment.cardId, "library", { libraryPosition: "top" });
    } else {
      moved = moveCard(moved, assignment.cardId, "exile");
      // Expressive Iteration: an impulse window on the card just exiled.
      // Cleared with the other entries at cleanup.
      if (prompt.exilePlayableThisTurn) {
        moved.exilePlayable = [
          ...(moved.exilePlayable ?? []),
          { cardId: assignment.cardId, casterId: prompt.playerId },
        ];
      }
      // Hideaway: the exiled card is recorded on the permanent that hid
      // it, so its own ability can play that card and no other.
      if (prompt.hideawaySourceId) {
        const hider = moved.cards[prompt.hideawaySourceId];
        if (hider) {
          hider.imprintedCardIds = [
            ...(hider.imprintedCardIds ?? []),
            assignment.cardId,
          ];
        }
      }
    }
  }
  return moved;
}
