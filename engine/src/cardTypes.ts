import type { CardCharacteristics, CardInstanceId, GameState } from "./types";

export function definitionTypeLine(state: GameState, cardId: CardInstanceId): string {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  return state.definitions[card.definitionId]?.typeLine.toLowerCase() ?? "";
}

const EMPTY_CHARACTERISTICS: CardCharacteristics = {
  supertypes: [],
  types: [],
  subtypes: [],
  colors: [],
  manaValue: 0,
};

/**
 * Printed characteristics of a card's current definition. Once continuous
 * effects land (layer system), queries route through the computed
 * characteristics instead of reading these directly.
 */
export function characteristicsOf(state: GameState, cardId: CardInstanceId): CardCharacteristics {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  return state.definitions[card.definitionId]?.characteristics ?? EMPTY_CHARACTERISTICS;
}

export function hasType(state: GameState, cardId: CardInstanceId, type: string): boolean {
  return characteristicsOf(state, cardId).types.includes(type);
}

export function hasSubtype(state: GameState, cardId: CardInstanceId, subtype: string): boolean {
  return characteristicsOf(state, cardId).subtypes.includes(subtype);
}

export function hasSupertype(state: GameState, cardId: CardInstanceId, supertype: string): boolean {
  return characteristicsOf(state, cardId).supertypes.includes(supertype);
}

export function isInstant(state: GameState, cardId: CardInstanceId): boolean {
  return hasType(state, cardId, "instant");
}

export function isSorcery(state: GameState, cardId: CardInstanceId): boolean {
  return hasType(state, cardId, "sorcery");
}

export function isInstantOrSorcery(state: GameState, cardId: CardInstanceId): boolean {
  return isInstant(state, cardId) || isSorcery(state, cardId);
}

export function isLand(state: GameState, cardId: CardInstanceId): boolean {
  return hasType(state, cardId, "land");
}

export function isClass(state: GameState, cardId: CardInstanceId): boolean {
  return hasSubtype(state, cardId, "class");
}

export function isCreature(state: GameState, cardId: CardInstanceId): boolean {
  return hasType(state, cardId, "creature");
}

export function isPlaneswalker(state: GameState, cardId: CardInstanceId): boolean {
  return hasType(state, cardId, "planeswalker");
}

export function isMainPhase(state: GameState): boolean {
  return state.turn.phase === "precombatMain" || state.turn.phase === "postcombatMain";
}

export const COMMANDER_DAMAGE_TO_LOSE = 21;

export function isCommander(state: GameState, cardId: CardInstanceId): boolean {
  return state.players.some((player) => player.commander.commanderIds.includes(cardId));
}

export function isLegendary(state: GameState, cardId: CardInstanceId): boolean {
  return hasSupertype(state, cardId, "legendary");
}

export function isBasic(state: GameState, cardId: CardInstanceId): boolean {
  return hasSupertype(state, cardId, "basic");
}
