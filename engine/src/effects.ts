import { cloneGameState } from "./clone";
import { createCardDefinition, createCardInstance } from "./createGame";
import { hasSubtype, isCreature } from "./cardTypes";
import { creatureToughness, wouldSkipDraw } from "./derived";
import { hasKeyword } from "./keywords";
import { addMana, tapCard, untapCard } from "./mana";
import { livingPlayers, nextLivingPlayerId } from "./players";
import { isPromptOpen, legalIdsForChooseSources } from "./prompt";
import { applyStateBasedActionsInPlace } from "./status";
import { isChosenTargetLegal } from "./targeting";
import { amassArmyTemplate } from "./tokens";
import { queueEnterBattlefieldTriggersInPlace } from "./triggers";
import { countCardPlacements, enterOwnerZone, moveCard } from "./zones";
import type {
  CardEffect,
  CardIdSelector,
  CardInstanceId,
  ChosenTarget,
  ChosenTargetRef,
  GameEffect,
  GameState,
  LookDestination,
  PlayerId,
  PlayerSelector,
  PlayerState,
  StackObjectId,
  TargetRequirement,
} from "./types";

export type BindEffectContext = {
  controllerId: PlayerId;
  sourceId: CardInstanceId | null;
  targets?: ChosenTarget[];
  targetRequirements?: TargetRequirement[];
  chosenCardId?: CardInstanceId;
};

function nextOpponentId(state: GameState, controllerId: PlayerId): PlayerId {
  return nextLivingPlayerId(state, controllerId);
}

function bindPlayerSelector(
  state: GameState,
  selector: PlayerSelector,
  context: BindEffectContext,
): PlayerId | null {
  if (typeof selector === "object") {
    const chosen = chosenTargetAt(context, selector.index, state);
    if (!chosen || chosen.type !== "player") {
      return null;
    }
    return chosen.playerId;
  }
  return bindPlayer(state, selector, context.controllerId);
}

function bindPlayer(state: GameState, selector: Exclude<PlayerSelector, ChosenTargetRef>, controllerId: PlayerId): PlayerId {
  if (selector === "controller") {
    return controllerId;
  }
  if (selector === "next_opponent") {
    return nextOpponentId(state, controllerId);
  }
  if (selector === "each_opponent") {
    throw new Error("each_opponent must be expanded before binding");
  }
  return selector;
}

function opponentIds(state: GameState, controllerId: PlayerId): PlayerId[] {
  return livingPlayers(state)
    .filter((player) => player.id !== controllerId)
    .map((player) => player.id);
}

function expandEachOpponent(
  state: GameState,
  effect: CardEffect,
  controllerId: PlayerId,
): CardEffect[] {
  const opponents = opponentIds(state, controllerId);
  if (
    (effect.kind === "gain_life" ||
      effect.kind === "lose_life" ||
      effect.kind === "draw" ||
      effect.kind === "add_mana" ||
      effect.kind === "mill" ||
      effect.kind === "discard") &&
    effect.playerId === "each_opponent"
  ) {
    return opponents.map((playerId) => ({ ...effect, playerId }));
  }
  if (effect.kind === "create_token" && effect.ownerId === "each_opponent") {
    return opponents.map((ownerId) => ({ ...effect, ownerId }));
  }
  if (
    effect.kind === "deal_damage" &&
    effect.target.type === "player" &&
    effect.target.playerId === "each_opponent"
  ) {
    return opponents.map((playerId) => ({
      ...effect,
      target: { type: "player" as const, playerId },
    }));
  }
  return [effect];
}

function bindSourceId(
  sourceId: CardInstanceId | "self" | null,
  context: BindEffectContext,
): CardInstanceId | null {
  if (sourceId === "self") {
    return context.sourceId;
  }
  return sourceId;
}

function chosenTargetAt(
  context: BindEffectContext,
  index: number,
  state: GameState,
): ChosenTarget | null {
  const requirement = context.targetRequirements?.[index];
  const target = context.targets?.[index];
  if (!requirement || !target || !isChosenTargetLegal(state, requirement, target, context.controllerId)) {
    return null;
  }
  return target;
}

function bindCardId(
  state: GameState,
  selector: CardIdSelector,
  context: BindEffectContext,
): CardInstanceId | null {
  if (typeof selector === "string") {
    if (selector === "self") {
      return context.sourceId;
    }
    if (selector === "chosen_card") {
      return context.chosenCardId ?? null;
    }
    return selector;
  }
  const chosen = chosenTargetAt(context, selector.index, state);
  if (!chosen || chosen.type !== "creature") {
    return null;
  }
  return chosen.cardId;
}

export function bindCardEffect(
  state: GameState,
  effect: CardEffect,
  context: BindEffectContext,
): GameEffect | null {
  switch (effect.kind) {
    case "gain_life":
    case "lose_life":
    case "draw":
    case "add_mana":
    case "mill":
    case "discard":
    case "scry":
    case "surveil":
    case "discard_unless_attacked": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        ...effect,
        playerId,
      };
    }
    case "amass": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "amass",
        playerId,
        amount: effect.amount,
        ...(effect.subtype ? { subtype: effect.subtype } : {}),
      };
    }
    case "look_and_assign": {
      const playerId = bindPlayerSelector(state, effect.playerId, context);
      if (!playerId) {
        return null;
      }
      return {
        kind: "look_and_assign",
        playerId,
        count: effect.count,
        destinations: [...effect.destinations],
      };
    }
    case "reveal_zone": {
      const fromPlayerId = bindPlayerSelector(state, effect.fromPlayerId, context);
      const toPlayerId = bindPlayerSelector(state, effect.toPlayerId, context);
      if (!fromPlayerId || !toPlayerId) {
        return null;
      }
      return { kind: "reveal_zone", fromPlayerId, toPlayerId, zone: effect.zone };
    }
    case "choose_card": {
      const chooserId = bindPlayerSelector(state, effect.chooserId, context);
      if (!chooserId) {
        return null;
      }
      const sources = effect.sources.flatMap((source) => {
        const playerId = bindPlayerSelector(state, source.playerId, context);
        return playerId ? [{ playerId, zone: source.zone, filter: source.filter }] : [];
      });
      if (sources.length === 0) {
        return null;
      }
      return {
        kind: "choose_card",
        chooserId,
        sources,
        thenEffects: effect.thenEffects.map((entry) => ({ ...entry })),
        sourceId: context.sourceId,
      };
    }
    case "deal_damage": {
      if (effect.target.type === "chosen") {
        const chosen = chosenTargetAt(context, effect.target.index, state);
        if (!chosen || chosen.type === "spell") {
          return null;
        }
        return {
          kind: "deal_damage",
          amount: effect.amount,
          sourceId: bindSourceId(effect.sourceId, context),
          target: chosen,
        };
      }
      if (effect.target.type === "player") {
        const playerId = bindPlayerSelector(state, effect.target.playerId, context);
        if (!playerId) {
          return null;
        }
        return {
          kind: "deal_damage",
          amount: effect.amount,
          sourceId: bindSourceId(effect.sourceId, context),
          target: { type: "player", playerId },
        };
      }
      return {
        kind: "deal_damage",
        amount: effect.amount,
        sourceId: bindSourceId(effect.sourceId, context),
        target: effect.target,
      };
    }
    case "create_token": {
      const ownerId = bindPlayerSelector(state, effect.ownerId, context);
      if (!ownerId) {
        return null;
      }
      return {
        ...effect,
        ownerId,
      };
    }
    case "move_card": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return {
        kind: "move_card",
        cardId,
        toZone: effect.toZone,
        libraryPosition: effect.libraryPosition,
      };
    }
    case "tap":
    case "untap": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: effect.kind, cardId };
    }
    case "sacrifice": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "sacrifice", cardId };
    }
    case "add_counter": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "add_counter", cardId, counter: effect.counter, amount: effect.amount };
    }
    case "set_class_level": {
      const cardId = bindCardId(state, effect.cardId, context);
      if (!cardId) {
        return null;
      }
      return { kind: "set_class_level", cardId, level: effect.level };
    }
    case "counter_spell": {
      const chosen = chosenTargetAt(context, effect.target.index, state);
      if (!chosen || chosen.type !== "spell") {
        return null;
      }
      return { kind: "counter_spell", stackObjectId: chosen.stackObjectId };
    }
    default: {
      const exhaustive: never = effect;
      throw new Error(`Unknown card effect ${(exhaustive as CardEffect).kind}`);
    }
  }
}

export function bindCardEffects(
  state: GameState,
  effects: CardEffect[],
  context: BindEffectContext,
): GameEffect[] {
  return effects.flatMap((effect) => {
    return expandEachOpponent(state, effect, context.controllerId).flatMap((item) => {
      const bound = bindCardEffect(state, item, context);
      return bound ? [bound] : [];
    });
  });
}

function requirePlayer(state: GameState, playerId: PlayerId): PlayerState {
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new Error(`Unknown player ${playerId}`);
  }
  return player;
}

function requirePositiveInteger(amount: number, label: string): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Invalid ${label}`);
  }
}

function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

function applyGainLife(state: GameState, playerId: PlayerId, amount: number): GameState {
  requirePositiveInteger(amount, "life gain");
  const next = cloneGameState(state);
  requirePlayer(next, playerId).life += amount;
  next.log.push({ kind: "life_change", playerId, delta: amount });
  return next;
}

function applyLoseLife(state: GameState, playerId: PlayerId, amount: number): GameState {
  requirePositiveInteger(amount, "life loss");
  const next = cloneGameState(state);
  requirePlayer(next, playerId).life -= amount;
  next.log.push({ kind: "life_change", playerId, delta: -amount });
  return next;
}

function applyDealDamage(state: GameState, effect: Extract<GameEffect, { kind: "deal_damage" }>): GameState {
  requirePositiveInteger(effect.amount, "damage");
  if (effect.sourceId && !state.cards[effect.sourceId]) {
    throw new Error(`Unknown source ${effect.sourceId}`);
  }

  if (effect.target.type === "player") {
    return applyLoseLife(state, effect.target.playerId, effect.amount);
  }

  const card = state.cards[effect.target.cardId];
  if (!card) {
    throw new Error(`Unknown card ${effect.target.cardId}`);
  }
  if (card.zone !== "battlefield" || !isCreature(state, card.id)) {
    throw new Error(`Card ${card.id} is not a creature on the battlefield`);
  }

  const next = cloneGameState(state);
  const damaged = next.cards[card.id];
  if (!damaged) {
    throw new Error(`Unknown card ${card.id}`);
  }
  damaged.damageMarked += effect.amount;
  const lethal =
    hasKeyword(next, damaged.id, "deathtouch") ||
    (effect.sourceId ? hasKeyword(next, effect.sourceId, "deathtouch") : false);
  const toughness = creatureToughness(next, damaged.id);
  if (
    ((lethal && effect.amount > 0) || damaged.damageMarked >= toughness) &&
    !hasKeyword(next, damaged.id, "indestructible")
  ) {
    return moveCard(next, damaged.id, "graveyard");
  }
  return next;
}

function applyDraw(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "draw count");
  if (wouldSkipDraw(state, playerId)) {
    return cloneGameState(state);
  }
  requirePlayer(state, playerId);
  let next = cloneGameState(state);
  for (let i = 0; i < count; i += 1) {
    if (wouldSkipDraw(next, playerId)) {
      return next;
    }
    const current = next.players.find((entry) => entry.id === playerId);
    if (!current) {
      throw new Error(`Unknown player ${playerId}`);
    }
    const top = current.zones.library[0];
    if (!top) {
      current.failedToDraw = true;
      return next;
    }
    next = moveCard(next, top, "hand");
  }
  return next;
}

function applyScry(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "scry count");
  const player = requirePlayer(state, playerId);
  const looked = Math.min(count, player.zones.library.length);
  if (looked === 0) {
    return cloneGameState(state);
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "scry",
    playerId,
    count: looked,
  });
  return next;
}

function applySurveil(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "surveil count");
  const player = requirePlayer(state, playerId);
  const looked = Math.min(count, player.zones.library.length);
  if (looked === 0) {
    return cloneGameState(state);
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "surveil",
    playerId,
    count: looked,
  });
  return next;
}

function applyMill(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "mill count");
  requirePlayer(state, playerId);
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const current = next.players.find((entry) => entry.id === playerId);
    const top = current?.zones.library[0];
    if (!top) {
      return next === state ? cloneGameState(state) : next;
    }
    next = moveCard(next, top, "graveyard");
  }
  return next;
}

function applyDiscard(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "discard count");
  requirePlayer(state, playerId);
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const current = next.players.find((entry) => entry.id === playerId);
    const first = current?.zones.hand[0];
    if (!first) {
      return next === state ? cloneGameState(state) : next;
    }
    next = moveCard(next, first, "graveyard");
  }
  return next;
}

function applySacrifice(state: GameState, cardId: CardInstanceId): GameState {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} is not on the battlefield`);
  }
  return moveCard(state, cardId, "graveyard");
}

function applyAddCounter(
  state: GameState,
  cardId: CardInstanceId,
  counter: string,
  amount: number,
): GameState {
  requirePositiveInteger(amount, "counter amount");
  if (!state.cards[cardId]) {
    throw new Error(`Unknown card ${cardId}`);
  }
  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  card.counters[counter] = (card.counters[counter] ?? 0) + amount;
  return next;
}

function applySetClassLevel(state: GameState, cardId: CardInstanceId, level: number): GameState {
  requirePositiveInteger(level, "class level");
  const next = cloneGameState(state);
  const card = next.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  if (card.zone !== "battlefield") {
    throw new Error(`Card ${cardId} is not on the battlefield`);
  }
  if (card.classLevel < 1) {
    throw new Error(`Card ${cardId} is not a Class`);
  }
  if (level !== card.classLevel + 1) {
    throw new Error("Class levels must be gained in order");
  }
  card.classLevel = level;
  return next;
}

function applyCounterSpell(state: GameState, stackObjectId: StackObjectId): GameState {
  const next = cloneGameState(state);
  const index = next.stack.findIndex((entry) => entry.id === stackObjectId);
  if (index === -1) {
    return next;
  }
  const [removed] = next.stack.splice(index, 1);
  if (!removed?.sourceId) {
    return next;
  }
  return enterOwnerZone(next, removed.sourceId, "graveyard");
}

function applyCreateToken(
  state: GameState,
  effect: Extract<GameEffect, { kind: "create_token" }>,
): GameState {
  requirePlayer(state, effect.ownerId);
  const next = cloneGameState(state);
  const definition = createCardDefinition({
    name: effect.name,
    typeLine: effect.typeLine,
    power: effect.power ?? null,
    toughness: effect.toughness ?? null,
  });
  const token = createCardInstance({
    definitionId: definition.id,
    ownerId: effect.ownerId,
    zone: "battlefield",
  });
  next.definitions[definition.id] = definition;
  next.cards[token.id] = token;
  const owner = next.players.find((player) => player.id === effect.ownerId);
  if (!owner) {
    throw new Error(`Unknown player ${effect.ownerId}`);
  }
  owner.zones.battlefield.push(token.id);
  if (countCardPlacements(next, token.id) !== 1) {
    throw new Error(`Token zone integrity failed for ${token.id}`);
  }
  queueEnterBattlefieldTriggersInPlace(next, token.id);
  return next;
}

function findControlledArmy(state: GameState, playerId: PlayerId): CardInstanceId | undefined {
  const player = state.players.find((entry) => entry.id === playerId);
  return player?.zones.battlefield.find((cardId) => {
    const card = state.cards[cardId];
    return Boolean(card && card.controllerId === playerId && hasSubtype(state, cardId, "army"));
  });
}

function applyAmass(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  subtype: string | undefined,
): GameState {
  requirePositiveInteger(amount, "amass amount");
  requirePlayer(state, playerId);
  let next = state;
  let armyId = findControlledArmy(next, playerId);
  if (!armyId) {
    const template = amassArmyTemplate(subtype);
    next = applyCreateToken(next, {
      kind: "create_token",
      ownerId: playerId,
      name: template.name,
      typeLine: template.typeLine,
      power: template.power,
      toughness: template.toughness,
    });
    armyId = findControlledArmy(next, playerId);
  }
  if (!armyId) {
    throw new Error("Amass failed to create an Army");
  }
  return applyAddCounter(next, armyId, "p1p1", amount);
}

function applyDiscardUnlessAttacked(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "discard count");
  const player = requirePlayer(state, playerId);
  if (player.attackedThisTurn) {
    return state;
  }
  const available = Math.min(count, player.zones.hand.length);
  if (available === 0) {
    return state;
  }
  const next = cloneGameState(state);
  next.prompts.push({ kind: "choose_discard", playerId, count: available });
  return next;
}

function applyRevealZone(
  state: GameState,
  fromPlayerId: PlayerId,
  toPlayerId: PlayerId,
  zone: "hand",
): GameState {
  requirePlayer(state, fromPlayerId);
  requirePlayer(state, toPlayerId);
  const from = state.players.find((entry) => entry.id === fromPlayerId);
  const next = cloneGameState(state);
  next.reveals.push({
    viewerId: toPlayerId,
    cardIds: [...(from?.zones[zone] ?? [])],
  });
  return next;
}

function applyChooseCardEffect(
  state: GameState,
  effect: Extract<GameEffect, { kind: "choose_card" }>,
): GameState {
  const legal = legalIdsForChooseSources(state, effect.sources);
  if (legal.length === 0) {
    return state;
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "choose_card",
    playerId: effect.chooserId,
    sources: effect.sources.map((source) => ({ ...source })),
    thenEffects: effect.thenEffects.map((entry) => ({ ...entry })),
    sourceId: effect.sourceId,
  });
  return next;
}

function applyLookAndAssign(
  state: GameState,
  playerId: PlayerId,
  count: number,
  destinations: LookDestination[],
): GameState {
  requirePositiveInteger(count, "look count");
  const player = requirePlayer(state, playerId);
  const looked = Math.min(count, player.zones.library.length);
  if (looked === 0 || destinations.length === 0) {
    return state;
  }
  const next = cloneGameState(state);
  next.prompts.push({
    kind: "look_and_assign",
    playerId,
    count: looked,
    destinations: destinations.slice(0, Math.max(looked, destinations.length)),
  });
  return next;
}

/**
 * Apply a reusable rules effect. Illegal effects throw and leave the original
 * GameState unchanged.
 */
export function applyEffect(state: GameState, effect: GameEffect): GameState {
  const before = snapshot(state);
  try {
    let next: GameState;
    switch (effect.kind) {
      case "gain_life":
        next = applyGainLife(state, effect.playerId, effect.amount);
        break;
      case "lose_life":
        next = applyLoseLife(state, effect.playerId, effect.amount);
        break;
      case "deal_damage":
        next = applyDealDamage(state, effect);
        break;
      case "draw":
        next = applyDraw(state, effect.playerId, effect.count);
        break;
      case "scry":
        next = applyScry(state, effect.playerId, effect.count);
        break;
      case "surveil":
        next = applySurveil(state, effect.playerId, effect.count);
        break;
      case "move_card":
        next = moveCard(state, effect.cardId, effect.toZone, {
          libraryPosition: effect.libraryPosition,
        });
        break;
      case "tap":
        next = tapCard(state, effect.cardId);
        break;
      case "untap":
        next = untapCard(state, effect.cardId);
        break;
      case "add_mana":
        next = addMana(state, effect.playerId, effect.mana);
        break;
      case "create_token":
        next = applyCreateToken(state, effect);
        break;
      case "mill":
        next = applyMill(state, effect.playerId, effect.count);
        break;
      case "discard":
        next = applyDiscard(state, effect.playerId, effect.count);
        break;
      case "sacrifice":
        next = applySacrifice(state, effect.cardId);
        break;
      case "add_counter":
        next = applyAddCounter(state, effect.cardId, effect.counter, effect.amount);
        break;
      case "counter_spell":
        next = applyCounterSpell(state, effect.stackObjectId);
        break;
      case "set_class_level":
        next = applySetClassLevel(state, effect.cardId, effect.level);
        break;
      case "discard_unless_attacked":
        next = applyDiscardUnlessAttacked(state, effect.playerId, effect.count);
        break;
      case "amass":
        next = applyAmass(state, effect.playerId, effect.amount, effect.subtype);
        break;
      case "reveal_zone":
        next = applyRevealZone(state, effect.fromPlayerId, effect.toPlayerId, effect.zone);
        break;
      case "choose_card":
        next = applyChooseCardEffect(state, effect);
        break;
      case "look_and_assign":
        next = applyLookAndAssign(state, effect.playerId, effect.count, effect.destinations);
        break;
      default: {
        const exhaustive: never = effect;
        throw new Error(`Unknown effect ${(exhaustive as GameEffect).kind}`);
      }
    }
    applyStateBasedActionsInPlace(next);
    return next;
  } catch (error) {
    if (JSON.stringify(state) !== before) {
      throw new Error("Illegal effect mutated GameState");
    }
    throw error;
  }
}

export function applyEffects(state: GameState, effects: GameEffect[]): GameState {
  let current = state;
  for (let index = 0; index < effects.length; index += 1) {
    current = applyEffect(current, effects[index]!);
    if (!isPromptOpen(current)) {
      continue;
    }
    const prompt = current.prompts[current.prompts.length - 1];
    if (
      prompt &&
      (prompt.kind === "scry" ||
        prompt.kind === "surveil" ||
        prompt.kind === "choose_discard" ||
        prompt.kind === "choose_card" ||
        prompt.kind === "look_and_assign")
    ) {
      const remaining = effects.slice(index + 1);
      if (remaining.length > 0) {
        prompt.resumeEffects = remaining;
      }
    }
    break;
  }
  return current;
}
