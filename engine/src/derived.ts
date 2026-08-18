import { isCreature, isLand, isLegendary } from "./cardTypes";
import type { CardInstance, CardInstanceId, EnterTappedUnless, GameState, StaticModifier } from "./types";

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

function controlledBattlefield(state: GameState, controllerId: string): CardInstance[] {
  return Object.values(state.cards).filter(
    (card) => card.zone === "battlefield" && card.controllerId === controllerId,
  );
}

function unlessSatisfied(
  state: GameState,
  card: CardInstance,
  unless: EnterTappedUnless,
): boolean {
  const controlled = controlledBattlefield(state, card.controllerId);
  if (unless.kind === "other_lands") {
    const others = controlled.filter((entry) => entry.id !== card.id && isLand(state, entry.id));
    return others.length >= unless.count;
  }
  if (unless.kind === "legendary_creature") {
    return controlled.some((entry) => isLegendary(state, entry.id) && isCreature(state, entry.id));
  }
  if (unless.kind === "basic_lands") {
    const basics = controlled.filter((entry) => {
      const typeLine = state.definitions[entry.definitionId]?.typeLine.toLowerCase() ?? "";
      return isLand(state, entry.id) && /\bbasic\b/.test(typeLine);
    });
    return basics.length >= unless.count;
  }
  return controlled.some((entry) => {
    const typeLine = state.definitions[entry.definitionId]?.typeLine.toLowerCase() ?? "";
    return unless.types.some((type) => typeLine.includes(type));
  });
}

/** Self-replacement: the permanent enters the battlefield tapped (CR 614.12). */
export function wouldEnterTapped(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards[cardId];
  if (!card) {
    return false;
  }
  return (state.definitions[card.definitionId]?.replacements ?? []).some((replacement) => {
    if (replacement.kind === "enters_tapped") {
      return true;
    }
    if (replacement.kind === "enters_tapped_unless") {
      return !unlessSatisfied(state, card, replacement.unless);
    }
    if (replacement.kind === "enters_tapped_if") {
      return unlessSatisfied(state, card, replacement.if);
    }
    return false;
  });
}

export function queueEnterReplacementChoicesInPlace(state: GameState, cardId: CardInstanceId): void {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield" || card.tapped) {
    return;
  }
  const definition = state.definitions[card.definitionId];
  for (const replacement of definition?.replacements ?? []) {
    if (replacement.kind !== "may_pay_life_or_enter_tapped") {
      continue;
    }
    state.prompts.push({
      kind: "may_pay_life_or_enter_tapped",
      playerId: card.controllerId,
      sourceId: card.id,
      amount: replacement.amount,
    });
  }
}
