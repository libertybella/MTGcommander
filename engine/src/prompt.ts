import { createId } from "./ids";
import { cloneGameState } from "./clone";
import { payManaCost, tapForMana } from "./mana";
import { manaAbilitiesOf, manaTapOptionsFor } from "./manaOptions";
import { isLiving, requireLiving } from "./players";
import { shuffleInPlace } from "./shuffle";
import { hasAnyLegalTargetSet, validateChosenTargets } from "./targeting";
import { processTriggerGroupsInPlace, queueDefinitionTriggerInPlace } from "./triggers";
import { enterOwnerZoneInPlace, moveCard } from "./zones";
import type {
  BoundChooseCardSource,
  CardEffect,
  CardInstanceId,
  ChosenTarget,
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

  validateChosenTargets(next, prompt.requirements, targets, playerId);
  next.stack.push({
    id: createId("stack"),
    controllerId: playerId,
    sourceId: prompt.sourceId,
    kind: "ability",
    targets: targets.map((target) => ({ ...target })),
    triggerIndex: prompt.triggerIndex,
  });
  next.passesSinceAction = 0;
  next.priorityPlayerId = next.turn.activePlayerId;
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
    queueDefinitionTriggerInPlace(next, entry.cardId, entry.triggerIndex);
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
    if (!traits.subtypes.includes(subtype)) {
      return false;
    }
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
  for (const cardId of cardIds) {
    next = moveCard(next, cardId, prompt.destination);
    if (prompt.destination === "battlefield" && prompt.entersTapped) {
      const fetched = next.cards[cardId];
      if (fetched && fetched.zone === "battlefield") {
        fetched.tapped = true;
      }
    }
  }
  const player = next.players.find((entry) => entry.id === playerId);
  if (player) {
    shuffleInPlace(player.zones.library, random);
  }
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
  if (!prompt || prompt.kind !== "pay_or_counter") {
    throw new Error("No payment pending");
  }
  requireLiving(state, playerId);
  if (prompt.playerId !== playerId) {
    throw new Error("It is not that player's choice");
  }
  let next = cloneGameState(state);
  next.prompts.shift();
  if (!pay) {
    const index = next.stack.findIndex((entry) => entry.id === prompt.stackObjectId);
    if (index !== -1) {
      const [removed] = next.stack.splice(index, 1);
      if (removed?.sourceId) {
        enterOwnerZoneInPlace(next, removed.sourceId, "graveyard");
      }
    }
    return next;
  }
  for (const tap of taps) {
    const card = next.cards[tap.cardId];
    if (!card || card.controllerId !== playerId || card.zone !== "battlefield" || card.tapped) {
      throw new Error("Cannot tap that permanent for mana");
    }
    const definition = next.definitions[card.definitionId];
    const abilities = definition ? manaAbilitiesOf(definition) : [];
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
  return payManaCost(next, playerId, prompt.cost);
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
  const usedDest = new Set<LookDestination>();
  const usedCard = new Set<CardInstanceId>();
  for (const assignment of assignments) {
    if (!lookedSet.has(assignment.cardId) || usedCard.has(assignment.cardId)) {
      throw new Error("Can only assign each looked-at card once");
    }
    if (!prompt.destinations.includes(assignment.destination) || usedDest.has(assignment.destination)) {
      throw new Error("Each destination can be used once");
    }
    usedCard.add(assignment.cardId);
    usedDest.add(assignment.destination);
  }
  const next = cloneGameState(state);
  next.prompts.shift();
  let moved = next;
  for (const assignment of assignments) {
    if (assignment.destination === "hand") {
      moved = moveCard(moved, assignment.cardId, "hand");
    } else if (assignment.destination === "library_bottom") {
      moved = moveCard(moved, assignment.cardId, "library", { libraryPosition: "bottom" });
    } else {
      moved = moveCard(moved, assignment.cardId, "exile");
    }
  }
  return moved;
}
