import { cloneGameState } from "./clone";
import { createCardDefinition, createCardInstance } from "./createGame";
import { isCreature } from "./cardTypes";
import { addMana, tapCard, untapCard } from "./mana";
import { countCardPlacements, moveCard } from "./zones";
import type {
  GameEffect,
  GameState,
  PlayerId,
  PlayerState,
} from "./types";

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
  const toughness = next.definitions[damaged.definitionId]?.toughness;
  if (toughness !== null && toughness !== undefined && damaged.damageMarked >= toughness) {
    return moveCard(next, damaged.id, "graveyard");
  }
  return next;
}

function applyDraw(state: GameState, playerId: PlayerId, count: number): GameState {
  requirePositiveInteger(count, "draw count");
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
  return next;
}

/**
 * Apply a reusable rules effect. Illegal effects throw and leave the original
 * GameState unchanged.
 */
export function applyEffect(state: GameState, effect: GameEffect): GameState {
  const before = snapshot(state);
  try {
    switch (effect.kind) {
      case "gain_life":
        return applyGainLife(state, effect.playerId, effect.amount);
      case "lose_life":
        return applyLoseLife(state, effect.playerId, effect.amount);
      case "deal_damage":
        return applyDealDamage(state, effect);
      case "draw":
        return applyDraw(state, effect.playerId, effect.count);
      case "move_card":
        return moveCard(state, effect.cardId, effect.toZone, {
          libraryPosition: effect.libraryPosition,
        });
      case "tap":
        return tapCard(state, effect.cardId);
      case "untap":
        return untapCard(state, effect.cardId);
      case "add_mana":
        return addMana(state, effect.playerId, effect.mana);
      case "create_token":
        return applyCreateToken(state, effect);
      default: {
        const exhaustive: never = effect;
        throw new Error(`Unknown effect ${(exhaustive as GameEffect).kind}`);
      }
    }
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
