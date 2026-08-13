import type { CardInstanceId, GameState, StaticModifier } from "./types";

function plus1Plus1(state: GameState, cardId: CardInstanceId): number {
  return state.cards[cardId]?.counters["p1p1"] ?? 0;
}

function modifiersFor(state: GameState, cardId: CardInstanceId): StaticModifier[] {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return [];
  }
  const result: StaticModifier[] = [];
  for (const other of Object.values(state.cards)) {
    if (other.zone !== "battlefield") {
      continue;
    }
    const definition = state.definitions[other.definitionId];
    for (const modifier of definition?.staticModifiers ?? []) {
      if (modifier.kind !== "pt") {
        continue;
      }
      if (modifier.selector === "self" && other.id === cardId) {
        result.push(modifier);
      }
      if (
        modifier.selector === "controlled_creatures" &&
        other.controllerId === card.controllerId
      ) {
        result.push(modifier);
      }
    }
  }
  return result;
}

export function creaturePower(state: GameState, cardId: CardInstanceId): number {
  const base = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.power ?? 0;
  const fromMods = modifiersFor(state, cardId).reduce((sum, modifier) => sum + modifier.power, 0);
  return Math.max(0, base + plus1Plus1(state, cardId) + fromMods);
}

export function creatureToughness(state: GameState, cardId: CardInstanceId): number {
  const base = state.definitions[state.cards[cardId]?.definitionId ?? ""]?.toughness ?? 0;
  const fromMods = modifiersFor(state, cardId).reduce((sum, modifier) => sum + modifier.toughness, 0);
  return Math.max(0, base + plus1Plus1(state, cardId) + fromMods);
}

export function wouldSkipDraw(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    return (state.definitions[card.definitionId]?.replacements ?? []).some(
      (replacement) => replacement.kind === "replace_draw" && replacement.instead === "skip",
    );
  });
}
