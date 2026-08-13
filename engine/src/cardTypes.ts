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

export function isCreature(state: GameState, cardId: CardInstanceId): boolean {
  return definitionTypeLine(state, cardId).includes("creature");
}

export function isMainPhase(state: GameState): boolean {
  return state.turn.phase === "precombatMain" || state.turn.phase === "postcombatMain";
}
