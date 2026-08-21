import type {
  CardCharacteristics,
  CardInstance,
  CardInstanceId,
  Color,
  ContinuousEffectData,
  DynamicCount,
  EffectSelector,
  GameState,
  Keyword,
  ManaAbility,
  StaticAbility,
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
  /** Mana abilities granted by statics (Cryptolith Rite). */
  grantedMana: ManaAbility[];
  /** Changeling: matches every creature type (cleared with abilities). */
  allCreatureTypes: boolean;
  /** Combat restrictions from layer-6 effects (Pacifism). */
  cantAttack: boolean;
  cantBlock: boolean;
  cantBeBlocked: boolean;
  /** Printed protection plus layer-6 grants (Akroma's Will). */
  protectionFrom: Color[];
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
  grant_protection: 6,
  grant_mana_ability: 6,
  remove_all_abilities: 6,
  restrict: 6,
  set_pt: 7.2,
  modify_pt: 7.3,
};

function baseComputed(state: GameState, card: CardInstance): ComputedCard {
  // A face-down permanent is a 2/2 colorless creature with no name, types,
  // or abilities (CR 708.2). Its printed card is hidden information.
  if (card.faceDown && card.zone === "battlefield") {
    return {
      characteristics: {
        supertypes: [],
        types: ["creature"],
        subtypes: [],
        colors: [],
        manaValue: 0,
      },
      keywords: [],
      abilitiesRemoved: true,
      power: 2,
      toughness: 2,
      grantedMana: [],
      allCreatureTypes: false,
      cantAttack: false,
      cantBlock: false,
      cantBeBlocked: false,
      protectionFrom: [],
    };
  }
  const definition = state.definitions[card.definitionId];
  const printed = definition?.characteristics ?? {
    supertypes: [],
    types: [],
    subtypes: [],
    colors: [],
    manaValue: 0,
  };
  // CR 613.3a: a characteristic-defining star P/T applies before every layer.
  const dynamic = definition?.dynamicPt
    ? dynamicCountOf(state, card.controllerId, definition.dynamicPt.count)
    : null;
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
    power: dynamic ?? definition?.power ?? 0,
    toughness: dynamic ?? definition?.toughness ?? 0,
    grantedMana: [],
    allCreatureTypes: definition?.changeling === true,
    cantAttack: false,
    cantBlock: false,
    cantBeBlocked: false,
    protectionFrom: [...(definition?.protectionFrom ?? [])],
  };
}

function dynamicCountOf(state: GameState, controllerId: string, count: DynamicCount): number {
  const player = state.players.find((entry) => entry.id === controllerId);
  if (!player) {
    return 0;
  }
  if (count === "cards_in_your_hand") {
    return player.zones.hand.length;
  }
  if (count === "cards_in_your_graveyard") {
    return player.zones.graveyard.length;
  }
  const wanted =
    count === "lands_you_control" ? "land" : count === "creatures_you_control" ? "creature" : "artifact";
  let total = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
      continue;
    }
    const types = state.definitions[card.definitionId]?.characteristics.types ?? [];
    if (types.includes(wanted)) {
      total += 1;
    }
  }
  return total;
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
  if (selector.excludeSelf && card.id === instance.sourceId) {
    return false;
  }
  if (selector.tokenOnly && !card.isToken) {
    return false;
  }
  if (selector.nonToken && card.isToken) {
    return false;
  }
  for (const type of selector.types ?? []) {
    if (!computed.characteristics.types.includes(type)) {
      return false;
    }
  }
  for (const subtype of selector.subtypes ?? []) {
    if (!computedSubtypeMatches(computed, subtype)) {
      return false;
    }
  }
  for (const color of selector.colors ?? []) {
    if (!computed.characteristics.colors.includes(color)) {
      return false;
    }
  }
  if (selector.chosenSubtype) {
    const source = instance.sourceId ? state.cards[instance.sourceId] : undefined;
    const chosen = source?.chosenCreatureType;
    if (!chosen || !computedSubtypeMatches(computed, chosen)) {
      return false;
    }
  }
  return true;
}

/**
 * Subtypes changeling can never grant: it is every CREATURE type only
 * (CR 702.73a). Queries for these land/artifact/enchantment subtypes must
 * not match a changeling.
 */
const NONCREATURE_SUBTYPES = new Set([
  "plains", "island", "swamp", "mountain", "forest", "desert", "gate", "cave",
  "lair", "locus", "sphere", "urza's", "mine", "power-plant", "tower",
  "equipment", "vehicle", "fortification", "treasure", "clue", "food", "blood",
  "gold", "incubator", "junk", "map", "powerstone", "aura", "curse", "shrine",
  "saga", "class", "background", "role", "case", "attraction", "contraption",
]);

function computedSubtypeMatches(computed: ComputedCard, subtype: string): boolean {
  return (
    computed.characteristics.subtypes.includes(subtype) ||
    (computed.allCreatureTypes && !NONCREATURE_SUBTYPES.has(subtype.toLowerCase()))
  );
}

/**
 * Does this card count as the given subtype, changeling included? The one
 * subtype query most callers should use. Works in every zone (CR 702.73:
 * changeling functions everywhere); on the battlefield, ability removal
 * (Humility) cancels it via the computed pass.
 */
export function cardMatchesSubtype(
  state: GameState,
  cardId: CardInstanceId,
  subtype: string,
): boolean {
  const card = state.cards[cardId];
  if (card?.zone === "battlefield") {
    const computed = computedCard(state, cardId);
    if (computed) {
      return computedSubtypeMatches(computed, subtype);
    }
  }
  const definition = card ? state.definitions[card.definitionId] : undefined;
  return (
    (definition?.characteristics.subtypes ?? []).includes(subtype) ||
    (definition?.changeling === true && !NONCREATURE_SUBTYPES.has(subtype.toLowerCase()))
  );
}

/** Printed-characteristics battlefield gate ("…and you control a Forest"). */
function staticGateSatisfied(
  state: GameState,
  controllerId: string,
  gate: StaticAbility["requiresControlled"],
): boolean {
  if (!gate) {
    return true;
  }
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
      return false;
    }
    const traits = state.definitions[card.definitionId]?.characteristics;
    if (!traits) {
      return false;
    }
    return (
      (gate.types ?? []).every((type) => traits.types.includes(type)) &&
      (gate.subtypes ?? []).every((subtype) => traits.subtypes.includes(subtype))
    );
  });
}

function collectInstances(state: GameState): EffectInstance[] {
  const instances: EffectInstance[] = [];
  for (const card of Object.values(state.cards)) {
    // Brawn-class statics work from the graveyard; everything else needs the
    // battlefield.
    const definition = state.definitions[card.definitionId];
    for (const ability of definition?.staticAbilities ?? []) {
      const zoneOk = ability.fromGraveyard
        ? card.zone === "graveyard"
        : card.zone === "battlefield" && !card.faceDown;
      if (!zoneOk) {
        continue;
      }
      if (!staticGateSatisfied(state, card.controllerId, ability.requiresControlled)) {
        continue;
      }
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
      case "grant_protection":
        for (const color of effect.colors) {
          if (!computed.protectionFrom.includes(color)) {
            computed.protectionFrom.push(color);
          }
        }
        break;
      case "grant_mana_ability":
        computed.grantedMana.push({ ...effect.ability });
        break;
      case "remove_all_abilities":
        computed.keywords = [];
        computed.abilitiesRemoved = true;
        computed.grantedMana = [];
        computed.allCreatureTypes = false;
        computed.protectionFrom = [];
        break;
      case "restrict": {
        // Wayward Swordtooth: the restriction lifts with the city's blessing.
        if (effect.unlessCityBlessing) {
          const source = instance.sourceId ? state.cards[instance.sourceId] : undefined;
          const controller = state.players.find((entry) => entry.id === source?.controllerId);
          if (controller?.cityBlessing) {
            break;
          }
        }
        computed.cantAttack = computed.cantAttack || effect.cantAttack === true;
        computed.cantBlock = computed.cantBlock || effect.cantBlock === true;
        computed.cantBeBlocked = computed.cantBeBlocked || effect.cantBeBlocked === true;
        break;
      }
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

  // Layer 7d: +1/+1 and -1/-1 counters net out.
  for (const card of Object.values(state.cards)) {
    const computed = computedById[card.id]!;
    const net = (card.counters["p1p1"] ?? 0) - (card.counters["m1m1"] ?? 0);
    computed.power = Math.max(0, computed.power + net);
    computed.toughness = computed.toughness + net;
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
