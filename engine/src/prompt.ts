import { createId } from "./ids";
import { cloneGameState } from "./clone";
// Deferred call only (decline path) — the effects/prompt import cycle is benign.
import { cardMatchesSubtype } from "./characteristicsEngine";
import { characteristicsOf, isCreature, isLand as cardIsLand, isPlaneswalker } from "./cardTypes";
import { applyEffects, grantProtectionUntilEot } from "./effects";
import { payManaCost, tapForMana } from "./mana";
import { manaAbilitiesFor, manaTapOptionsFor } from "./manaOptions";
import { isLiving, requireLiving } from "./players";
import { shuffleInPlace } from "./shuffle";
import { hasAnyLegalTargetSet, validateChosenTargets } from "./targeting";
import { dispatchEventsInPlace, processTriggerGroupsInPlace, queueDefinitionTriggerInPlace } from "./triggers";
import { enterOwnerZoneInPlace, moveCard } from "./zones";
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
  modeIndex: number,
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
  const trigger = source
    ? state.definitions[source.definitionId]?.triggers[prompt.triggerIndex]
    : undefined;
  const mode = trigger?.modes?.[modeIndex];
  if (!mode) {
    throw new Error("Choose one of the trigger's modes");
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  const requirements = mode.targetRequirements ?? [];
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
    modeIndex,
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
  if (filter === "land") {
    return types.includes("land");
  }
  if (filter === "creature") {
    return types.includes("creature");
  }
  if (filter === "nontoken_creature") {
    return types.includes("creature") && !card?.isToken;
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

export function legalIdsForChooseSources(
  state: GameState,
  sources: BoundChooseCardSource[],
): CardInstanceId[] {
  const ids: CardInstanceId[] = [];
  const seen = new Set<CardInstanceId>();
  for (const source of sources) {
    const player = state.players.find((entry) => entry.id === source.playerId);
    for (const cardId of player?.zones[source.zone] ?? []) {
      if (seen.has(cardId) || !cardMatchesFilter(state, cardId, source.filter)) {
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

export function applyResolveChooseCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): { next: GameState; thenEffects: CardEffect[]; sourceId: CardInstanceId | null; cardId: CardInstanceId } {
  const prompt = currentPrompt(state);
  if (!prompt || prompt.kind !== "choose_card") {
    throw new Error("No card choice pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  const legal = new Set(legalIdsForChooseSources(state, prompt.sources));
  if (!legal.has(cardId)) {
    throw new Error("That card is not a legal choice");
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  next.reveals = next.reveals.filter((entry) => entry.viewerId !== playerId);
  return { next, thenEffects: prompt.thenEffects, sourceId: prompt.sourceId, cardId };
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
  entered.definitionId = original.definitionId;
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
  return (player?.zones.library ?? []).filter((cardId) =>
    searchMatches(state, cardId, prompt.filter),
  );
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
    next = moveCard(next, cardId, prompt.destination);
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
  if (player) {
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
  next = payManaCost(next, playerId, prompt.cost);
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
    }
  }
  return moved;
}
