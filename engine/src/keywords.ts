import type { CardInstanceId, GameState, Keyword } from "./types";

export function cardKeywords(state: GameState, cardId: CardInstanceId): Keyword[] {
  const card = state.cards[cardId];
  if (!card) {
    return [];
  }
  return state.definitions[card.definitionId]?.keywords ?? [];
}

export function hasKeyword(state: GameState, cardId: CardInstanceId, keyword: Keyword): boolean {
  return cardKeywords(state, cardId).includes(keyword);
}
