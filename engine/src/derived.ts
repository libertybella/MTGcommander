import { characteristicsOf, isBasic, isCreature, isLand, isLegendary } from "./cardTypes";
import { abilitiesRemoved, computedCard } from "./characteristicsEngine";
import type { CardInstance, CardInstanceId, EnterTappedUnless, GameState } from "./types";

function plus1Plus1(state: GameState, cardId: CardInstanceId): number {
  return state.cards[cardId]?.counters["p1p1"] ?? 0;
}

/** Final power: the layer engine for battlefield objects, printed elsewhere. */
export function creaturePower(state: GameState, cardId: CardInstanceId): number {
  const card = state.cards[cardId];
  if (card?.zone === "battlefield") {
    return computedCard(state, cardId)?.power ?? 0;
  }
  const base = state.definitions[card?.definitionId ?? ""]?.power ?? 0;
  return Math.max(0, base + plus1Plus1(state, cardId));
}

export function creatureToughness(state: GameState, cardId: CardInstanceId): number {
  const card = state.cards[cardId];
  if (card?.zone === "battlefield") {
    return computedCard(state, cardId)?.toughness ?? 0;
  }
  const base = state.definitions[card?.definitionId ?? ""]?.toughness ?? 0;
  return Math.max(0, base + plus1Plus1(state, cardId));
}

export function wouldSkipDraw(state: GameState, playerId: string): boolean {
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    if (abilitiesRemoved(state, card.id)) {
      return false;
    }
    return (state.definitions[card.definitionId]?.replacements ?? []).some(
      (replacement) => replacement.kind === "replace_draw" && replacement.instead === "skip",
    );
  });
}

/** CR 402.2: 7 unless a permanent removes the maximum. null means no maximum. */
export function maxHandSizeOf(state: GameState, playerId: string): number | null {
  const unlimited = Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      return false;
    }
    if (abilitiesRemoved(state, card.id)) {
      return false;
    }
    return state.definitions[card.definitionId]?.noMaxHandSize === true;
  });
  return unlimited ? null : 7;
}

/**
 * CR 601.2f: total generic discount the player's permanents give a spell
 * with these printed characteristics (medallions, Foundry Inspector).
 */
export function castCostReduction(
  state: GameState,
  playerId: string,
  spell: { characteristics: { types: string[]; colors: string[] } },
): number {
  let total = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    for (const reduction of state.definitions[card.definitionId]?.costReductions ?? []) {
      const { types, typesAny, colors } = reduction.filter;
      if (types && !types.every((type) => spell.characteristics.types.includes(type))) {
        continue;
      }
      if (typesAny && !typesAny.some((type) => spell.characteristics.types.includes(type))) {
        continue;
      }
      if (colors && !colors.some((color) => spell.characteristics.colors.includes(color))) {
        continue;
      }
      total += reduction.generic;
    }
  }
  return total;
}

/** CR 305.2: one land drop plus any extras granted by permanents (Exploration). */
export function landDropAllowance(state: GameState, playerId: string): number {
  let extra = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== playerId) {
      continue;
    }
    if (abilitiesRemoved(state, card.id)) {
      continue;
    }
    extra += state.definitions[card.definitionId]?.extraLandDrops ?? 0;
  }
  return 1 + extra;
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
  if (unless.kind === "other_lands_at_most") {
    const others = controlled.filter((entry) => entry.id !== card.id && isLand(state, entry.id));
    return others.length <= unless.count;
  }
  if (unless.kind === "opponents") {
    const opponents = state.players.filter(
      (player) => player.id !== card.controllerId && !player.lost,
    );
    return opponents.length >= unless.count;
  }
  if (unless.kind === "legendary_creature") {
    return controlled.some((entry) => isLegendary(state, entry.id) && isCreature(state, entry.id));
  }
  if (unless.kind === "basic_lands") {
    const basics = controlled.filter(
      (entry) => isLand(state, entry.id) && isBasic(state, entry.id),
    );
    return basics.length >= unless.count;
  }
  return controlled.some((entry) => {
    const printed = characteristicsOf(state, entry.id);
    return unless.types.some(
      (type) => printed.subtypes.includes(type) || printed.types.includes(type),
    );
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
  if (!card || card.zone !== "battlefield") {
    return;
  }
  const definition = state.definitions[card.definitionId];
  if (!card.tapped) {
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
  if (definition?.chooseCreatureTypeOnEnter && card.chosenCreatureType === null) {
    state.prompts.push({
      kind: "choose_creature_type",
      playerId: card.controllerId,
      sourceId: card.id,
    });
  }
}
