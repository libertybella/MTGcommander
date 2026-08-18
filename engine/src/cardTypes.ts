import type { CardInstanceId, GameState } from "./types";

export function definitionTypeLine(state: GameState, cardId: CardInstanceId): string {
  const card = state.cards[cardId];
  if (!card) {
    throw new Error(`Unknown card ${cardId}`);
  }
  return state.definitions[card.definitionId]?.typeLine.toLowerCase() ?? "";
}

export function isInstant(state: GameState, cardId: CardInstanceId): boolean {
  return definitionTypeLine(state, cardId).includes("instant");
}

export function isSorcery(state: GameState, cardId: CardInstanceId): boolean {
  return definitionTypeLine(state, cardId).includes("sorcery");
}

export function isInstantOrSorcery(state: GameState, cardId: CardInstanceId): boolean {
  return isInstant(state, cardId) || isSorcery(state, cardId);
}

export function isLand(state: GameState, cardId: CardInstanceId): boolean {
  return definitionTypeLine(state, cardId).includes("land");
}

export function isClass(state: GameState, cardId: CardInstanceId): boolean {
  return definitionTypeLine(state, cardId).includes("class");
}

export function isCreature(state: GameState, cardId: CardInstanceId): boolean {
  return definitionTypeLine(state, cardId).includes("creature");
}

export function isPlaneswalker(state: GameState, cardId: CardInstanceId): boolean {
  return definitionTypeLine(state, cardId).includes("planeswalker");
}

export function isMainPhase(state: GameState): boolean {
  return state.turn.phase === "precombatMain" || state.turn.phase === "postcombatMain";
}

export const COMMANDER_DAMAGE_TO_LOSE = 21;

export function isCommander(state: GameState, cardId: CardInstanceId): boolean {
  return state.players.some((player) => player.commander.commanderIds.includes(cardId));
}

export function isLegendary(state: GameState, cardId: CardInstanceId): boolean {
  return definitionTypeLine(state, cardId).includes("legendary");
}
