import { computedCard } from "./characteristicsEngine";
import type { CardInstanceId, GameState, Keyword } from "./types";

/**
 * A card's current keywords. Battlefield objects go through the layer engine
 * (grants, removals, until-end-of-turn effects); elsewhere the printed
 * definition applies.
 */
export function cardKeywords(state: GameState, cardId: CardInstanceId): Keyword[] {
  const card = state.cards[cardId];
  if (!card) {
    return [];
  }
  if (card.zone === "battlefield") {
    return computedCard(state, cardId)?.keywords ?? [];
  }
  return state.definitions[card.definitionId]?.keywords ?? [];
}

export function hasKeyword(state: GameState, cardId: CardInstanceId, keyword: Keyword): boolean {
  return cardKeywords(state, cardId).includes(keyword);
}
