import { cloneGameState } from "./clone";
import { createCardDefinition, createCardInstance } from "./createGame";
import { isCreature } from "./cardTypes";
import { creatureToughness, wouldSkipDraw } from "./derived";
import { hasKeyword } from "./keywords";
import { addMana, tapCard, untapCard } from "./mana";
import { nextLivingPlayerId } from "./players";
import { applyStateBasedActionsInPlace } from "./status";
import { isChosenTargetLegal } from "./targeting";
import { queueEnterBattlefieldTriggersInPlace } from "./triggers";
import { countCardPlacements, moveCard } from "./zones";
import type {
  CardEffect,
  CardIdSelector,
  CardInstanceId,
  ChosenTarget,
  GameEffect,
  GameState,
  PlayerId,
  PlayerSelector,
  PlayerState,
  TargetRequirement,
} from "./types";

export type BindEffectContext = {
  controllerId: PlayerId;
  sourceId: CardInstanceId | null;
  targets?: ChosenTarget[];
  targetRequirements?: TargetRequirement[];
};

function nextOpponentId(state: GameState, controllerId: PlayerId): PlayerId {
  return nextLivingPlayerId(state, controllerId);
}

function bindPlayer(state: GameState, selector: PlayerSelector, controllerId: PlayerId): PlayerId {
  if (selector === "controller") {
    return controllerId;
  }
  if (selector === "next_opponent") {
    return nextOpponentId(state, controllerId);
  }
  return selector;
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
      return {
        ...effect,
        playerId: bindPlayer(state, effect.playerId, context.controllerId),
      };
    case "deal_damage": {
      if (effect.target.type === "chosen") {
        const chosen = chosenTargetAt(context, effect.target.index, state);
        if (!chosen) {
          return null;
        }
        return {
          kind: "deal_damage",
          amount: effect.amount,
          sourceId: bindSourceId(effect.sourceId, context),
          target: chosen,
        };
      }
      return {
        kind: "deal_damage",
        amount: effect.amount,
        sourceId: bindSourceId(effect.sourceId, context),
        target:
          effect.target.type === "player"
            ? {
                type: "player",
                playerId: bindPlayer(state, effect.target.playerId, context.controllerId),
              }
            : effect.target,
      };
    }
    case "create_token":
      return {
        ...effect,
        ownerId: bindPlayer(state, effect.ownerId, context.controllerId),
      };
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
    case "mill":
    case "discard":
      return {
        ...effect,
        playerId: bindPlayer(state, effect.playerId, context.controllerId),
      };
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
    const bound = bindCardEffect(state, effect, context);
    return bound ? [bound] : [];
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
  return next;
}

function applyLoseLife(state: GameState, playerId: PlayerId, amount: number): GameState {
  requirePositiveInteger(amount, "life loss");
  const next = cloneGameState(state);
  requirePlayer(next, playerId).life -= amount;
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
  const player = requirePlayer(state, playerId);
  if (player.zones.library.length < count) {
    throw new Error("Library is empty");
  }
  let next = state;
  for (let i = 0; i < count; i += 1) {
    const current = next.players.find((entry) => entry.id === playerId);
    const top = current?.zones.library[0];
    if (!top) {
      throw new Error("Library is empty");
    }
    next = moveCard(next, top, "hand");
  }
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
  for (const effect of effects) {
    current = applyEffect(current, effect);
  }
  return current;
}
