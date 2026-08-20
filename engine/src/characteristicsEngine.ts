import type {
  CardCharacteristics,
  CardInstance,
  CardInstanceId,
  ContinuousEffectData,
  EffectSelector,
  GameState,
  Keyword,
} from "./types";

/**
 * The CR 613 layer engine (Stage 2 of the Comprehensive Plan).
 *
 * Characteristics are never stored: every query derives them from printed
 * values plus the continuous effects currently in existence — battlefield
 * static abilities and resolved until-end-of-turn effects. An effect exists
 * exactly as long as its source is findable (statics) or until the cleanup
 * sweep (durations), so "always honored until the card leaves play" needs no
 * bookkeeping at all.
 *
 * Layers implemented: 4 (types), 5 (colors), 6 (abilities, including
 * remove-all), 7b (set P/T), 7c (modify P/T), 7d (+1/+1 counters). Within a
 * layer, effects apply in timestamp order (CR 613.7). Dependency (CR 613.8)
 * is not implemented; the layer ordering itself already resolves the common
 * interactions (Humility + anthem in either order).
 */
export type ComputedCard = {
  characteristics: CardCharacteristics;
  keywords: Keyword[];
  /** True when a layer-6 remove-all effect hit this object (Humility). */
  abilitiesRemoved: boolean;
  /** Final power/toughness including counters. Zero for non-creatures. */
  power: number;
  toughness: number;
};

type EffectInstance = {
  sourceId: CardInstanceId | null;
  /** Static abilities select dynamically; duration effects lock their set. */
  selector: EffectSelector | null;
  affected: CardInstanceId[] | null;
  effect: ContinuousEffectData;
  timestamp: number;
  fromStatic: boolean;
};

const LAYER_OF: Record<ContinuousEffectData["kind"], number> = {
  add_types: 4,
  set_colors: 5,
  grant_keyword: 6,
  remove_all_abilities: 6,
  set_pt: 7.2,
  modify_pt: 7.3,
};

function baseComputed(state: GameState, card: CardInstance): ComputedCard {
  const definition = state.definitions[card.definitionId];
  const printed = definition?.characteristics ?? {
    supertypes: [],
    types: [],
    subtypes: [],
    colors: [],
    manaValue: 0,
  };
  return {
    characteristics: {
      supertypes: [...printed.supertypes],
      types: [...printed.types],
      subtypes: [...printed.subtypes],
      colors: [...printed.colors],
      manaValue: printed.manaValue,
    },
    keywords: [...(definition?.keywords ?? [])],
    abilitiesRemoved: false,
    power: definition?.power ?? 0,
    toughness: definition?.toughness ?? 0,
  };
}

function matches(
  computedById: Record<CardInstanceId, ComputedCard>,
  state: GameState,
  instance: EffectInstance,
  card: CardInstance,
): boolean {
  if (card.zone !== "battlefield") {
    return false;
  }
  if (instance.affected) {
    return instance.affected.includes(card.id);
  }
  const selector = instance.selector;
  if (!selector) {
    return false;
  }
  if (selector.scope === "self") {
    return card.id === instance.sourceId;
  }
  if (selector.scope === "attached") {
    const source = instance.sourceId ? state.cards[instance.sourceId] : undefined;
    return Boolean(source?.attachedTo && source.attachedTo === card.id);
  }
  if (selector.scope === "controlled") {
    const source = instance.sourceId ? state.cards[instance.sourceId] : undefined;
    if (!source || card.controllerId !== source.controllerId) {
      return false;
    }
  }
  const computed = computedById[card.id];
  if (!computed) {
    return false;
  }
  for (const type of selector.types ?? []) {
    if (!computed.characteristics.types.includes(type)) {
      return false;
    }
  }
  for (const subtype of selector.subtypes ?? []) {
    if (!computed.characteristics.subtypes.includes(subtype)) {
      return false;
    }
  }
  return true;
}

function collectInstances(state: GameState): EffectInstance[] {
  const instances: EffectInstance[] = [];
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield") {
      continue;
    }
    const definition = state.definitions[card.definitionId];
    for (const ability of definition?.staticAbilities ?? []) {
      instances.push({
        sourceId: card.id,
        selector: ability.selector,
        affected: null,
        effect: ability.effect,
        timestamp: card.timestamp,
        fromStatic: true,
      });
    }
  }
  for (const effect of state.activeEffects) {
    instances.push({
      sourceId: effect.sourceId,
      selector: null,
      affected: effect.affected,
      effect: effect.effect,
      timestamp: effect.timestamp,
      fromStatic: false,
    });
  }
  return instances.sort(
    (a, b) => LAYER_OF[a.effect.kind] - LAYER_OF[b.effect.kind] || a.timestamp - b.timestamp,
  );
}

function applyInstance(
  computedById: Record<CardInstanceId, ComputedCard>,
  state: GameState,
  instance: EffectInstance,
): void {
  for (const card of Object.values(state.cards)) {
    if (!matches(computedById, state, instance, card)) {
      continue;
    }
    const computed = computedById[card.id]!;
    const effect = instance.effect;
    switch (effect.kind) {
      case "add_types": {
        for (const type of effect.types) {
          if (!computed.characteristics.types.includes(type)) {
            computed.characteristics.types.push(type);
          }
        }
        for (const subtype of effect.subtypes) {
          if (!computed.characteristics.subtypes.includes(subtype)) {
            computed.characteristics.subtypes.push(subtype);
          }
        }
        break;
      }
      case "set_colors":
        computed.characteristics.colors = [...effect.colors];
        break;
      case "grant_keyword":
        if (!computed.keywords.includes(effect.keyword)) {
          computed.keywords.push(effect.keyword);
        }
        break;
      case "remove_all_abilities":
        computed.keywords = [];
        computed.abilitiesRemoved = true;
        break;
      case "set_pt":
        computed.power = effect.power;
        computed.toughness = effect.toughness;
        break;
      case "modify_pt":
        computed.power += effect.power;
        computed.toughness += effect.toughness;
        break;
      default: {
        const exhaustive: never = effect;
        throw new Error(`Unknown continuous effect ${(exhaustive as ContinuousEffectData).kind}`);
      }
    }
  }
}

function computeAll(state: GameState): Record<CardInstanceId, ComputedCard> {
  const computedById: Record<CardInstanceId, ComputedCard> = {};
  for (const card of Object.values(state.cards)) {
    computedById[card.id] = baseComputed(state, card);
  }

  const instances = collectInstances(state);
  // Sources whose abilities a layer-6 remove-all took away contribute none of
  // their own static abilities from that point on (Humility silences lords).
  const silencedSources = new Set<CardInstanceId>();
  for (const instance of instances) {
    if (instance.fromStatic && instance.sourceId && silencedSources.has(instance.sourceId)) {
      continue;
    }
    applyInstance(computedById, state, instance);
    if (instance.effect.kind === "remove_all_abilities") {
      for (const card of Object.values(state.cards)) {
        if (computedById[card.id]?.abilitiesRemoved) {
          silencedSources.add(card.id);
        }
      }
    }
  }

  // Layer 7d: +1/+1 counters.
  for (const card of Object.values(state.cards)) {
    const computed = computedById[card.id]!;
    const plus = card.counters["p1p1"] ?? 0;
    computed.power = Math.max(0, computed.power + plus);
    computed.toughness = Math.max(0, computed.toughness + plus);
  }
  return computedById;
}

/**
 * Computed characteristics for every object. Recomputed per call: several
 * engine paths mutate a state in place (SBA sweeps, step entry), so a
 * per-state cache would go stale mid-action. Profile before memoizing —
 * table-scale states are small (Stage 7 owns the optimization).
 */
export function computedCards(state: GameState): Record<CardInstanceId, ComputedCard> {
  return computeAll(state);
}

export function computedCard(state: GameState, cardId: CardInstanceId): ComputedCard | null {
  return computedCards(state)[cardId] ?? null;
}

/** True when a remove-all-abilities effect (Humility) silences this object. */
export function abilitiesRemoved(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return false;
  }
  return computedCard(state, cardId)?.abilitiesRemoved ?? false;
}
