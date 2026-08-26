import { colorsOutsideCommanderIdentity } from "./commanderIdentity";
import type {
  ActivatedAbility,
  CardCharacteristics,
  CardDefinition,
  CardInstance,
  CardInstanceId,
  CardTrigger,
  Color,
  ContinuousEffectData,
  ControlledGate,
  DynamicCount,
  EffectSelector,
  GameState,
  Keyword,
  ManaAbility,
  PlayerId,
  ProtectionFrom,
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
  /**
   * Triggered abilities granted by statics (Kaldra Compleat's equipped
   * creature). They are this object's own abilities: read them with
   * `triggersOf`, which appends them AFTER the printed ones so a trigger
   * index addresses one list, not two.
   */
  grantedTriggers: CardTrigger[];
  /**
   * The Ring's emblem is on this creature. Read by the blocking rules for
   * tier one — "can't be blocked by creatures with greater power" — which
   * is a restriction rather than an ability and so has nowhere else to go.
   */
  ringBearer?: boolean;
  /**
   * Activated abilities granted by statics (Bootleggers' Stash). Read them
   * with `activatedOf`, which appends them after the printed ones.
   */
  grantedActivated: ActivatedAbility[];
  /** Keywords this permanent "can't have or gain" (Archetype of
   * Imagination). Stripped after every grant has run, so a later grant
   * cannot win on timestamp the way it beats `remove_keywords`. */
  lockedKeywords: Keyword[];
  /** Changeling: matches every creature type (cleared with abilities). */
  allCreatureTypes: boolean;
  /** Combat restrictions from layer-6 effects (Pacifism). */
  cantAttack: boolean;
  cantBlock: boolean;
  cantBeBlocked: boolean;
  /** Printed protection plus layer-6 grants (Akroma's Will). */
  protectionFrom: ProtectionFrom;
  /**
   * Printed "Hexproof from black" plus layer-6 grants. Kept apart from
   * `protectionFrom` because the two are not the same shield: hexproof
   * from a colour stops that colour TARGETING this permanent and nothing
   * else — no damage prevention, no blocking restriction, no Aura ban.
   */
  hexproofFrom: Color[];
  /** Printed ward plus layer-6 grants (Lavaspur Boots); 0 means none. */
  ward: number;
  /** Ward paid in life (CR 702.21b), taxed separately from `ward`. */
  wardLife: number;
  /**
   * Every player who has goaded this creature — the instance's own record
   * (from the goad effect, which expires) merged with any static that says it
   * is goaded for as long as the static lasts (Shiny Impetus).
   */
  goadedBy: PlayerId[];
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

/** Counters that grant their own keyword to the permanent (CR 122.1e). */
const KEYWORD_COUNTERS: Keyword[] = ["indestructible", "flying"];

const LAYER_OF: Record<ContinuousEffectData["kind"], number> = {
  add_types: 4,
  set_types: 4,
  all_creature_types: 4,
  set_colors: 5,
  grant_keyword: 6,
  grant_protection: 6,
  grant_hexproof_from: 6,
  grant_ward: 6,
  grant_ward_life: 6,
  remove_keywords: 6,
  lock_keywords: 6,
  grant_mana_ability: 6,
  grant_trigger: 6,
  grant_activated: 6,
  goaded: 6,
  remove_all_abilities: 6,
  restrict: 6,
  set_pt: 7.2,
  modify_pt: 7.3,
};

/**
 * Union two protection shapes. Protection abilities do not stack in any way
 * that matters here — a source stopped by either is stopped — so merging is
 * a union per field rather than a list of separate abilities.
 */
export function mergeProtection(a: ProtectionFrom, b: ProtectionFrom): ProtectionFrom {
  const union = (left?: string[], right?: string[]) =>
    left || right ? [...new Set([...(left ?? []), ...(right ?? [])])] : undefined;
  // Destructured so a NEW ProtectionFrom field is a tsc error here rather
  // than a silent drop. It was one: `colorsOutsideCommanderIdentity`
  // merged away to nothing, which made the whole quality unreadable and
  // the card a miss, with no note pointing anywhere near here.
  const {
    colors: aColors,
    types: aTypes,
    subtypes: aSubtypes,
    multicolored: aMulti,
    colorless: aColorless,
    everything: aEverything,
    colorsOutsideCommanderIdentity: aOutside,
    ...aRest
  } = a;
  const exhaustive: Record<string, never> = aRest;
  void exhaustive;
  const colors = union(aColors, b.colors) as Color[] | undefined;
  const types = union(aTypes, b.types);
  const subtypes = union(aSubtypes, b.subtypes);
  return {
    ...(colors && colors.length > 0 ? { colors } : {}),
    ...(types && types.length > 0 ? { types } : {}),
    ...(subtypes && subtypes.length > 0 ? { subtypes } : {}),
    ...(aMulti || b.multicolored ? { multicolored: true } : {}),
    ...(aColorless || b.colorless ? { colorless: true } : {}),
    ...(aEverything || b.everything ? { everything: true } : {}),
    ...(aOutside || b.colorsOutsideCommanderIdentity
      ? { colorsOutsideCommanderIdentity: true }
      : {}),
  };
}

/**
 * Bestow (CR 702.103): a permanent cast for its bestow cost is an AURA for
 * as long as it stays attached, and the creature it is printed as the moment
 * it comes loose. A per-instance type change, so it belongs here beside the
 * face-down one rather than in any layer a static could reach.
 */
function bestowedAsAura(card: CardInstance): boolean {
  return card.bestowed === true && card.attachedTo !== null && card.zone === "battlefield";
}

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
      grantedTriggers: [],
      grantedActivated: [],
      lockedKeywords: [],
      allCreatureTypes: false,
      cantAttack: false,
      cantBlock: false,
      cantBeBlocked: false,
      protectionFrom: {},
      hexproofFrom: [],
      ward: 0,
      wardLife: 0,
      goadedBy: [...(card.goadedBy ?? [])],
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
    ? dynamicCountOf(state, card.controllerId, definition.dynamicPt.count, card.id)
    : null;
  // Storm-Kiln Artist: "+1/+0 for each artifact you control" self-buff.
  const bonusCount =
    definition?.bonusPt && card.zone === "battlefield"
      ? dynamicCountOf(state, card.controllerId, definition.bonusPt.per, card.id)
      : 0;
  const bonusPower = (definition?.bonusPt?.power ?? 0) * bonusCount;
  const bonusToughness = (definition?.bonusPt?.toughness ?? 0) * bonusCount;
  // Theros gods: below the devotion threshold the god isn't a creature.
  // Applied to the battlefield object before the layer passes — a
  // documented simplification (rulings apply it in all zones).
  const gate = definition?.notCreatureBelowDevotion;
  const gateHolds =
    gate &&
    card.zone === "battlefield" &&
    devotionPips(state, card.controllerId, gate.color) < gate.threshold;
  return {
    characteristics: {
      supertypes: [...printed.supertypes],
      // Bestow: attached, it is an Aura and not a creature — so it does not
      // attack, does not block, is not counted by a lord, and is not hit by
      // a board wipe. Every one of those follows from this line. Reconfigure
      // (CR 702.151) does the same to an Equipment-creature while it is
      // attached to something.
      types:
        gateHolds ||
        bestowedAsAura(card) ||
        (Boolean(definition?.reconfigure) &&
          card.attachedTo !== null &&
          card.zone === "battlefield")
          ? printed.types.filter((type) => type !== "creature")
          : [...printed.types],
      // Metallic Mimic: "~ is the chosen type in addition to its other
      // types" folds the entry choice into the computed subtypes, so every
      // subtype query (lords, tribal counts, chosen-type watchers) sees it.
      subtypes: [
        ...printed.subtypes,
        // Metallic Mimic: "~ is the chosen type in addition to its other
        // types" folds the entry choice in, so every subtype query sees it.
        ...(definition?.selfIsChosenType && card.chosenCreatureType
          ? [card.chosenCreatureType]
          : []),
        // Portal to Phyrexia: a type the permanent picked up on the way in.
        ...(card.addedSubtypes ?? []),
        // …and an Aura is what a bestowed permanent is while it is attached.
        ...(bestowedAsAura(card) && !printed.subtypes.includes("aura") ? ["aura"] : []),
      ],
      colors: [...printed.colors],
      manaValue: printed.manaValue,
    },
    // Keyword counters (CR 122.1e): a permanent with an indestructible
    // counter on it has indestructible. The Dominus cycle puts them on;
    // shield counters and the rest would join this map when they arrive.
    keywords: [
      ...(definition?.keywords ?? []),
      ...KEYWORD_COUNTERS.filter((keyword) => (card.counters[keyword] ?? 0) > 0),
    ],
    abilitiesRemoved: false,
    power: (dynamic ?? definition?.power ?? 0) + bonusPower,
    // Adeline: her POWER counts creatures while her toughness stays the
    // printed 4. Applying the count to both would rewrite a number the
    // card never touches.
    toughness:
      (definition?.dynamicPt?.powerOnly ? definition?.toughness ?? 0 : dynamic ?? definition?.toughness ?? 0) +
      bonusToughness,
    grantedMana: [],
    grantedTriggers: [],
    grantedActivated: [],
    lockedKeywords: [],
    allCreatureTypes: definition?.changeling === true,
    cantAttack: false,
    cantBlock: false,
    cantBeBlocked: false,
    protectionFrom: { ...(definition?.protectionFrom ?? {}) },
    hexproofFrom: [...(definition?.hexproofFrom ?? [])],
    ward: definition?.ward ?? 0,
    wardLife: definition?.wardLife ?? 0,
    // The instance's own record is the base; statics add to it in layer 6.
    goadedBy: [...(card.goadedBy ?? [])],
  };
}

/** CR 700.5 pips of one color across a player's permanents' mana costs.
 * Reads printed definitions directly — no computed pass, no import cycle. */
function devotionPips(state: GameState, controllerId: string, color: Color): number {
  let pips = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
      continue;
    }
    const manaCost = state.definitions[card.definitionId]?.manaCost ?? "";
    for (const symbol of manaCost.matchAll(/\{([^}]+)\}/g)) {
      if (symbol[1]!.toUpperCase().split("/").includes(color)) {
        pips += 1;
      }
    }
  }
  return pips;
}

/**
 * How many of the thing a "for each …" clause counts. `sourceId` is only
 * needed by the counts that read the source itself ("for each Aura attached
 * to it"); everything else counts the controller's board or zones.
 */
export function dynamicCountOf(
  state: GameState,
  controllerId: string,
  count: DynamicCount,
  sourceId?: CardInstanceId,
): number {
  const player = state.players.find((entry) => entry.id === controllerId);
  if (!player) {
    return 0;
  }
  // Earthshaker Dreadmaw: "for each (other) <subtype> you control" — count the
  // creatures you control of that subtype, dropping the source under "other".
  // Printed characteristics, like the rest of this function: reading the layer
  // engine's own output here would recurse. Changelings are the documented
  // gap this leaves.
  if (typeof count === "object") {
    return player.zones.battlefield.filter((id) => {
      if (count.excludeSelf && id === sourceId) {
        return false;
      }
      const printed = state.definitions[state.cards[id]?.definitionId ?? ""]?.characteristics;
      return (
        printed !== undefined &&
        printed.types.includes("creature") &&
        printed.subtypes.map((entry) => entry.toLowerCase()).includes(count.subtype)
      );
    }).length;
  }
  if (count === "cards_in_your_hand") {
    return player.zones.hand.length;
  }
  if (count === "cards_in_your_graveyard") {
    return player.zones.graveyard.length;
  }
  if (count === "creature_cards_in_your_graveyard") {
    return player.zones.graveyard.filter((id) =>
      (state.definitions[state.cards[id]?.definitionId ?? ""]?.characteristics.types ?? []).includes(
        "creature",
      ),
    ).length;
  }
  // Moraug: attacks made by the object the ability AFFECTS. Read off that
  // card, the same way the attachment counts below are — which is what
  // makes one static hand each creature a different bonus.
  if (count === "times_it_has_attacked_this_turn") {
    return sourceId ? state.cards[sourceId]?.timesAttackedThisTurn ?? 0 : 0;
  }
  // Kor Spiritdancer / Thran Power Suit: attachments ON the source. Printed
  // types, like the rest of this function — the layer engine cannot read its
  // own output here.
  if (count === "auras_attached_to_it" || count === "auras_and_equipment_attached_to_it") {
    if (!sourceId) {
      return 0;
    }
    return Object.values(state.cards).filter((card) => {
      if (card.zone !== "battlefield" || card.attachedTo !== sourceId) {
        return false;
      }
      const subtypes = state.definitions[card.definitionId]?.characteristics.subtypes ?? [];
      return (
        subtypes.includes("aura") ||
        (count === "auras_and_equipment_attached_to_it" && subtypes.includes("equipment"))
      );
    }).length;
  }
  if (
    count === "creatures_sharing_a_type_with_it" ||
    count === "attacking_creatures_sharing_a_type_with_it"
  ) {
    if (!sourceId) {
      return 0;
    }
    const subject = computedCard(state, sourceId);
    if (!subject) {
      return 0;
    }
    // A changeling shares with everything that has a creature type at all
    // (CR 702.73), so its own list is not what to compare against.
    const subjectIsChangeling = subject.allCreatureTypes;
    const own = subject.characteristics.subtypes.filter(
      (subtype) => !NONCREATURE_SUBTYPES.has(subtype.toLowerCase()),
    );
    let total = 0;
    for (const other of Object.values(state.cards)) {
      if (other.zone !== "battlefield" || other.id === sourceId) {
        continue;
      }
      if (
        count === "attacking_creatures_sharing_a_type_with_it" &&
        !other.attacking
      ) {
        continue;
      }
      const computed = computedCard(state, other.id);
      if (!computed || !computed.characteristics.types.includes("creature")) {
        continue;
      }
      const theirs = computed.characteristics.subtypes.filter(
        (subtype) => !NONCREATURE_SUBTYPES.has(subtype.toLowerCase()),
      );
      const shares = subjectIsChangeling
        ? computed.allCreatureTypes || theirs.length > 0
        : computed.allCreatureTypes
          ? own.length > 0
          : own.some((subtype) => theirs.includes(subtype));
      if (shares) {
        total += 1;
      }
    }
    return total;
  }
  if (count === "colors_among_permanents_you_control") {
    const colors = new Set<string>();
    for (const card of Object.values(state.cards)) {
      if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
        continue;
      }
      for (const color of state.definitions[card.definitionId]?.characteristics.colors ?? []) {
        colors.add(color);
      }
    }
    return colors.size;
  }
  if (count === "colorless_creatures_you_control" || count === "creatures_you_control_with_a_counter") {
    let total = 0;
    for (const card of Object.values(state.cards)) {
      if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
        continue;
      }
      const traits = state.definitions[card.definitionId]?.characteristics;
      if (!(traits?.types ?? []).includes("creature")) {
        continue;
      }
      if (count === "colorless_creatures_you_control") {
        if ((traits?.colors ?? []).length === 0) {
          total += 1;
        }
        continue;
      }
      if (Object.values(card.counters).some((amount) => amount > 0)) {
        total += 1;
      }
    }
    return total;
  }
  if (
    count === "artifacts_and_enchantments_you_control" ||
    count === "creatures_and_enchantments_you_control"
  ) {
    // Nettlecyst: "and/or" — a card that is both counts once.
    const first = count === "artifacts_and_enchantments_you_control" ? "artifact" : "creature";
    let both = 0;
    for (const card of Object.values(state.cards)) {
      if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
        continue;
      }
      const types = state.definitions[card.definitionId]?.characteristics.types ?? [];
      if (types.includes(first) || types.includes("enchantment")) {
        both += 1;
      }
    }
    return both;
  }
  // Sage's Reverie counts YOUR Auras by where they are attached, so unlike
  // `auras_attached_to_it` the source is irrelevant and the host must be a
  // creature — an Aura on a land or a player does not count.
  if (count === "auras_you_control_attached_to_a_creature") {
    return Object.values(state.cards).filter((card) => {
      if (card.zone !== "battlefield" || card.controllerId !== controllerId || !card.attachedTo) {
        return false;
      }
      if (!(state.definitions[card.definitionId]?.characteristics.subtypes ?? []).includes("aura")) {
        return false;
      }
      const host = state.cards[card.attachedTo];
      return (
        host?.zone === "battlefield" &&
        (state.definitions[host.definitionId]?.characteristics.types ?? []).includes("creature")
      );
    }).length;
  }
  if (count === "legendary_creatures_you_control" || count === "attacking_creatures_you_control") {
    let total = 0;
    for (const card of Object.values(state.cards)) {
      if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
        continue;
      }
      const traits = state.definitions[card.definitionId]?.characteristics;
      if (!(traits?.types ?? []).includes("creature")) {
        continue;
      }
      if (
        count === "attacking_creatures_you_control"
          ? card.attacking
          : (traits?.supertypes ?? []).includes("legendary")
      ) {
        total += 1;
      }
    }
    return total;
  }
  if (count === "permanents_you_control") {
    return Object.values(state.cards).filter(
      (card) => card.zone === "battlefield" && card.controllerId === controllerId,
    ).length;
  }
  // The turn tally, not the hand: a card drawn and then discarded still
  // counted, and a card put into hand some other way never did. The same
  // number the `drew_cards_this_turn` trigger condition already reads.
  if (count === "cards_drawn_this_turn") {
    return state.drawsByPlayerThisTurn?.[controllerId] ?? 0;
  }
  // Basic land types are SUBTYPES, so a Swamp is anything with the subtype —
  // an Urborg'd Island counts, which is the whole point of the wording.
  const BASIC_LAND_COUNTS: Partial<Record<Extract<DynamicCount, string>, string>> = {
    plains_you_control: "plains",
    islands_you_control: "island",
    swamps_you_control: "swamp",
    mountains_you_control: "mountain",
    forests_you_control: "forest",
  };
  const landType = BASIC_LAND_COUNTS[count];
  if (landType) {
    return Object.values(state.cards).filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === controllerId &&
        (state.definitions[card.definitionId]?.characteristics.subtypes ?? []).includes(landType),
    ).length;
  }
  // Aragorn and Arwen, Wed: "for each OTHER creature you control" — the same
  // controlled-creature count as below, minus the source itself.
  if (count === "other_creatures_you_control") {
    let total = 0;
    for (const card of Object.values(state.cards)) {
      if (
        card.zone !== "battlefield" ||
        card.controllerId !== controllerId ||
        card.id === sourceId
      ) {
        continue;
      }
      if (
        (state.definitions[card.definitionId]?.characteristics.types ?? []).includes("creature")
      ) {
        total += 1;
      }
    }
    return total;
  }
  // Keep Watch: "for each attacking creature" — every attacker, any controller.
  if (count === "attacking_creatures") {
    let total = 0;
    for (const card of Object.values(state.cards)) {
      if (card.zone !== "battlefield" || !card.attacking) {
        continue;
      }
      if (
        (state.definitions[card.definitionId]?.characteristics.types ?? []).includes("creature")
      ) {
        total += 1;
      }
    }
    return total;
  }
  // A table rather than a chain of ternaries: `count` is narrowed to exactly
  // the rows left, so a new member of the union that belongs here is a tsc
  // error rather than a silent fall-through onto whichever type came last.
  const wanted: Record<typeof count, string> = {
    lands_you_control: "land",
    creatures_you_control: "creature",
    enchantments_you_control: "enchantment",
    artifacts_you_control: "artifact",
    plains_you_control: "land",
    islands_you_control: "land",
    swamps_you_control: "land",
    mountains_you_control: "land",
    forests_you_control: "land",
  };
  let total = 0;
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
      continue;
    }
    const types = state.definitions[card.definitionId]?.characteristics.types ?? [];
    if (types.includes(wanted[count])) {
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
  if (card.zone !== "battlefield" || card.phasedOut) {
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
    if (!source?.attachedTo || source.attachedTo !== card.id) {
      return false;
    }
    // Falls through to the refinements below rather than returning here:
    // Champion's Helm is "attached AND legendary", and an early return made
    // every other clause on an attached selector silently inert.
  }
  if (selector.scope === "controlled") {
    const source = instance.sourceId ? state.cards[instance.sourceId] : undefined;
    if (!source || card.controllerId !== source.controllerId) {
      return false;
    }
  }
  if (selector.scope === "opponents") {
    const source = instance.sourceId ? state.cards[instance.sourceId] : undefined;
    if (!source || card.controllerId === source.controllerId) {
      return false;
    }
  }
  // Soulbond: the source and its partner, but only while the pair is valid
  // (both on the battlefield under one control).
  if (selector.scope === "soulbond_pair") {
    const source = instance.sourceId ? state.cards[instance.sourceId] : undefined;
    const partnerId = source?.soulbondPartner;
    const partner = partnerId ? state.cards[partnerId] : undefined;
    const paired = Boolean(
      source &&
        partner &&
        partner.zone === "battlefield" &&
        partner.controllerId === source.controllerId,
    );
    if (!paired) {
      return false;
    }
    return card.id === instance.sourceId || card.id === partnerId;
  }
  const computed = computedById[card.id];
  if (!computed) {
    return false;
  }
  if (selector.legendary && !computed.characteristics.supertypes.includes("legendary")) {
    return false;
  }
  if (
    selector.nonTypes &&
    selector.nonTypes.some((type) => computed.characteristics.types.includes(type))
  ) {
    return false;
  }
  // Read the COMPUTED keywords, so a granted flying counts and a Humility'd
  // one does not.
  if (selector.withoutKeyword && computed.keywords.includes(selector.withoutKeyword)) {
    return false;
  }
  if (selector.withKeyword && !computed.keywords.includes(selector.withKeyword)) {
    return false;
  }
  if (selector.nonLegendary && computed.characteristics.supertypes.includes("legendary")) {
    return false;
  }
  // Inlined rather than imported from cardTypes: that module reads computed
  // characteristics, and the layer engine must not re-enter its own output.
  if (
    selector.commanderOnly &&
    !state.players.some((player) => player.commander.commanderIds.includes(card.id))
  ) {
    return false;
  }
  if (selector.withCounter && (card.counters[selector.withCounter] ?? 0) <= 0) {
    return false;
  }
  // Innkeeper's Talent: "with counters on them" — any kind at all. A zeroed
  // entry left behind by a removal is not a counter, so the values are read
  // rather than the keys.
  if (
    selector.withAnyCounter &&
    !Object.values(card.counters).some((count) => typeof count === "number" && count > 0)
  ) {
    return false;
  }
  // Counters have to be added by hand here: this runs during layer 6 and
  // layer 7d has not applied them to `computed` yet, so a creature with
  // +1/+1 counters would otherwise be read at its printed size.
  //
  // Statics that change power from ANOTHER source are seen or not
  // depending on instance order, which is the CR 613.8 dependency gap
  // this engine already documents. Counters are the common case and are
  // exact.
  if (selector.maxPower !== undefined || selector.maxPowerOrToughness !== undefined) {
    const size = withCounterNet(computed, card);
    if (selector.maxPower !== undefined && size.power > selector.maxPower) {
      return false;
    }
    if (
      selector.maxPowerOrToughness !== undefined &&
      size.power > selector.maxPowerOrToughness &&
      size.toughness > selector.maxPowerOrToughness
    ) {
      return false;
    }
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
  if (selector.chosenColor) {
    const source = instance.sourceId ? state.cards[instance.sourceId] : undefined;
    const chosen = source?.chosenColor;
    if (!chosen || !computed.characteristics.colors.includes(chosen)) {
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

/**
 * The single "you control …" gate matcher, shared by every carrier of a
 * `ControlledGate` (activated abilities, mana abilities, static abilities,
 * graveyard-cast conditions). `read` and `subtypeMatches` supply each
 * permanent's traits, because the two callers need different sources:
 * gameplay checks want *computed* characteristics, while the layer engine
 * itself must read *printed* ones or it would recurse into its own output.
 *
 * Four hand-written copies of this logic had drifted apart before it was
 * factored out here — the `subtypesAny` half was added to three of them and
 * silently defaulted to "any permanent matches" in the fourth.
 */
function gateSatisfied(
  state: GameState,
  controllerId: string,
  gate: ControlledGate,
  read: (cardId: CardInstanceId) => { traits: CardCharacteristics; power: number } | null,
  subtypeMatches: (cardId: CardInstanceId, subtype: string) => boolean,
): boolean {
  const controlled = Object.values(state.cards).filter(
    (card) => card.zone === "battlefield" && card.controllerId === controllerId,
  );
  // "a Plains or a Swamp": any one of the listed subtypes satisfies the gate,
  // and the halves may sit on different permanents.
  if (
    gate.subtypesAny &&
    !gate.subtypesAny.some((subtype) =>
      controlled.some((card) => subtypeMatches(card.id, subtype)),
    )
  ) {
    return false;
  }
  if (!gate.types && !gate.subtypes && !gate.legendary && gate.minPower === undefined) {
    return true;
  }
  // "…seven or more lands": a count, so the question is how many satisfy the
  // clauses rather than whether any one does.
  const matches = (card: { id: CardInstanceId }): boolean => {
    const info = read(card.id);
    if (!info) {
      return false;
    }
    if (gate.legendary && !info.traits.supertypes.includes("legendary")) {
      return false;
    }
    if (gate.minPower !== undefined && info.power < gate.minPower) {
      return false;
    }
    return (
      (gate.types ?? []).every((type) => info.traits.types.includes(type)) &&
      (gate.subtypes ?? []).every((subtype) => subtypeMatches(card.id, subtype))
    );
  };
  if (gate.atLeast !== undefined) {
    return controlled.filter((card) => matches(card)).length >= gate.atLeast;
  }
  // The remaining clauses must all hold of one and the same permanent.
  return controlled.some((card) => {
    const info = read(card.id);
    if (!info) {
      return false;
    }
    if (gate.legendary && !info.traits.supertypes.includes("legendary")) {
      return false;
    }
    if (gate.minPower !== undefined && info.power < gate.minPower) {
      return false;
    }
    return (
      (gate.types ?? []).every((type) => info.traits.types.includes(type)) &&
      (gate.subtypes ?? []).every((subtype) => subtypeMatches(card.id, subtype))
    );
  });
}

/**
 * Computed-characteristics battlefield gate — the gameplay entry point.
 * Bonders' Enclave reads current power, so counters and pumps count.
 */
export function controlsGate(
  state: GameState,
  controllerId: string,
  gate: ControlledGate,
): boolean {
  return gateSatisfied(
    state,
    controllerId,
    gate,
    (cardId) => {
      const computed = computedCard(state, cardId);
      return computed ? { traits: computed.characteristics, power: computed.power } : null;
    },
    (cardId, subtype) => cardMatchesSubtype(state, cardId, subtype),
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
  const printed = (cardId: CardInstanceId): CardDefinition | undefined => {
    const card = state.cards[cardId];
    return card ? state.definitions[card.definitionId] : undefined;
  };
  return gateSatisfied(
    state,
    controllerId,
    gate,
    (cardId) => {
      const definition = printed(cardId);
      return definition
        ? { traits: definition.characteristics, power: definition.power ?? 0 }
        : null;
    },
    (cardId, subtype) => (printed(cardId)?.characteristics.subtypes ?? []).includes(subtype),
  );
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
        : card.zone === "battlefield" && !card.faceDown && !card.phasedOut;
      if (!zoneOk) {
        continue;
      }
      if (!staticGateSatisfied(state, card.controllerId, ability.requiresControlled)) {
        continue;
      }
      // Beastmaster Ascension: live only past the counter threshold.
      if (
        ability.requiresCounters &&
        (card.counters[ability.requiresCounters.counter] ?? 0) <
          ability.requiresCounters.atLeast
      ) {
        continue;
      }
      // Topiary Stomper: the restriction is ON only while the board is BELOW
      // the gate; reaching it lifts the ability entirely.
      if (
        ability.requiresControlledBelow &&
        staticGateSatisfied(state, card.controllerId, ability.requiresControlledBelow)
      ) {
        continue;
      }
      // Delirium (CR 702.130-adjacent): four or more card types among the
      // controller's graveyard, counted from printed types.
      if (ability.requiresDelirium) {
        const owner = state.players.find((entry) => entry.id === card.controllerId);
        const types = new Set<string>();
        for (const gravestoneId of owner?.zones.graveyard ?? []) {
          const dead = state.cards[gravestoneId];
          for (const type of state.definitions[dead?.definitionId ?? ""]?.characteristics.types ??
            []) {
            types.add(type);
          }
        }
        if (types.size < 4) {
          continue;
        }
      }
      // Razorkin Needlehead: live only while its controller is the active
      // player. Read here, with the rest of the static's gates, so the
      // keyword comes and goes with the turn rather than being granted once.
      if (ability.requiresYourTurn && state.turn.activePlayerId !== card.controllerId) {
        continue;
      }
      // Serra Ascendant: "As long as you have 30 or more life".
      if (ability.requiresLife !== undefined) {
        const owner = state.players.find((entry) => entry.id === card.controllerId);
        if ((owner?.life ?? 0) < ability.requiresLife) {
          continue;
        }
      }
      // Bloodghast: "as long as an opponent has 10 or less life" — ANY one
      // opponent, and a player who has lost is not one of them.
      if (ability.requiresOpponentLifeAtMost !== undefined) {
        const bar = ability.requiresOpponentLifeAtMost;
        const anyLow = state.players.some(
          (entry) => entry.id !== card.controllerId && !entry.lost && entry.life <= bar,
        );
        if (!anyLow) {
          continue;
        }
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
      case "all_creature_types":
        // Maskwood Nexus (layer 4): the affected are every creature type.
        computed.allCreatureTypes = true;
        break;
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
      case "set_types": {
        // Replaces, where `add_types` above adds. Subtypes go with the
        // types they belonged to: a creature that becomes a land is not a
        // land Goblin.
        computed.characteristics.types = [...effect.types];
        computed.characteristics.subtypes = [...(effect.subtypes ?? [])];
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
      case "grant_hexproof_from":
        // Merged as a set, not assigned: two grants of different colours
        // are two shields, and a last-writer-wins assignment would drop one.
        for (const color of effect.colors) {
          if (!computed.hexproofFrom.includes(color)) {
            computed.hexproofFrom.push(color);
          }
        }
        break;
      case "grant_protection": {
        // Two protection abilities merge into one shape rather than stacking
        // as separate ones — every field ORs, so the merge cannot lose a
        // quality the way a last-writer-wins assignment would.
        //
        // Commander's Plate resolves its colours HERE, against the
        // GRANTING permanent's controller — "your commander" is the
        // Equipment's controller, not the equipped creature's, and those
        // come apart the moment control of the creature changes.
        let from = effect.from;
        if (from.colorsOutsideCommanderIdentity) {
          const granterId = instance.sourceId
            ? state.cards[instance.sourceId]?.controllerId
            : undefined;
          const outside = granterId
            ? colorsOutsideCommanderIdentity(state, granterId)
            : [];
          const { colorsOutsideCommanderIdentity: _flag, ...rest } = from;
          from = { ...rest, colors: [...(rest.colors ?? []), ...outside] };
        }
        computed.protectionFrom = mergeProtection(computed.protectionFrom, from);
        break;
      }
      case "grant_ward":
        // Highest wins rather than stacking: CR 702.21c would have each ward
        // ability trigger separately, which the single pay-or-counter prompt
        // cannot express (documented).
        computed.ward = Math.max(computed.ward, effect.amount);
        break;
      case "grant_ward_life":
        computed.wardLife = Math.max(computed.wardLife, effect.amount);
        break;
      case "remove_keywords":
        // Shadowspear: strip the listed keywords (later grants can re-add
        // by timestamp, matching CR 613.7).
        computed.keywords = computed.keywords.filter(
          (keyword) => !effect.keywords.includes(keyword),
        );
        break;
      case "lock_keywords":
        // Archetype of Imagination: recorded rather than applied here,
        // because a grant later in the same layer would otherwise win.
        // computeAll strips the locked set once every grant has run.
        for (const keyword of effect.keywords) {
          if (!computed.lockedKeywords.includes(keyword)) {
            computed.lockedKeywords.push(keyword);
          }
        }
        break;
      case "grant_mana_ability":
        computed.grantedMana.push({ ...effect.ability });
        break;
      case "grant_trigger":
        // Cloned, because the granted ability is now the AFFECTED card's and
        // several cards may hold grants from one source; sharing the object
        // would let a per-card edit reach all of them.
        computed.grantedTriggers.push(structuredClone(effect.trigger));
        break;
      case "grant_activated":
        computed.grantedActivated.push(structuredClone(effect.ability));
        break;
      case "goaded": {
        // The goader is whoever controls the source of the static.
        const by = state.cards[instance.sourceId ?? ""]?.controllerId;
        if (by && !computed.goadedBy.includes(by)) {
          computed.goadedBy.push(by);
        }
        break;
      }
      case "remove_all_abilities":
        computed.keywords = [];
        computed.abilitiesRemoved = true;
        computed.grantedMana = [];
        computed.grantedTriggers = [];
        computed.grantedActivated = [];
        computed.lockedKeywords = [];
        computed.allCreatureTypes = false;
        computed.protectionFrom = {};
        computed.ward = 0;
        computed.wardLife = 0;
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
      case "modify_pt": {
        // Nettlecyst: "+1/+1 for each artifact and/or enchantment you
        // control" — the count reads the STATIC SOURCE's controller.
        // Banner of Kinship: perSourceCounter reads the SOURCE's counters.
        const multiplier = effect.perSourceCounter
          ? state.cards[instance.sourceId ?? ""]?.counters[effect.perSourceCounter] ?? 0
          : effect.per
            ? dynamicCountOf(
                state,
                state.cards[instance.sourceId ?? ""]?.controllerId ?? "",
                effect.per,
                // "…for each Aura attached to IT" means the object the ability
                // affects, which is the source only when the ability is its
                // own (Kor Spiritdancer). On an Equipment the buff lands on
                // the equipped creature, and it is that creature's
                // attachments Thran Power Suit counts. Passing the source
                // instead left the count silently 0, so the buff compiled,
                // typechecked, and did nothing.
                card.id,
              )
            : 1;
        computed.power += effect.power * multiplier;
        computed.toughness += effect.toughness * multiplier;
        break;
      }
      default: {
        const exhaustive: never = effect;
        throw new Error(`Unknown continuous effect ${(exhaustive as ContinuousEffectData).kind}`);
      }
    }
  }
}

/**
 * Layer 7d: +1/+1 and -1/-1 counters net out.
 *
 * Shared because a selector that asks about power or toughness runs during
 * layer 6, before 7d has been applied — so it has to add the net itself or
 * it reads a creature as smaller than it is. Two copies of this arithmetic
 * would be two chances to disagree about whether power floors at zero.
 */
function withCounterNet(computed: ComputedCard, card: CardInstance): {
  power: number;
  toughness: number;
} {
  const net = (card.counters["p1p1"] ?? 0) - (card.counters["m1m1"] ?? 0);
  return {
    power: Math.max(0, computed.power + net),
    toughness: computed.toughness + net,
  };
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

  // A locked keyword loses to nothing: applied after every grant has run,
  // because "can't have or gain" outranks a later timestamp rather than
  // racing it.
  for (const computed of Object.values(computedById)) {
    if (computed.lockedKeywords.length === 0) {
      continue;
    }
    computed.keywords = computed.keywords.filter(
      (keyword) => !computed.lockedKeywords.includes(keyword),
    );
  }

  applyRingBearerAbilitiesInPlace(state, computedById);

  // Layer 7d: +1/+1 and -1/-1 counters net out.
  for (const card of Object.values(state.cards)) {
    const computed = computedById[card.id]!;
    const netted = withCounterNet(computed, card);
    computed.power = netted.power;
    computed.toughness = netted.toughness;
  }
  return computedById;
}

/**
 * The Ring's emblem (CR 701.52b-e). Its four abilities are all about the
 * Ring-bearer and switch on cumulatively as their controller is tempted,
 * so they are DERIVED onto that one creature here rather than living on a
 * permanent — there is no permanent. Being granted through the ordinary
 * `grantedTriggers` channel means the stack, the prompts, the fuzzer and
 * the client all reach them with the machinery they already have.
 *
 * The emblem is not an ability of the bearer, so `abilitiesRemoved` does
 * not silence it: Humility takes the creature's abilities, not the Ring's.
 */
function applyRingBearerAbilitiesInPlace(
  state: GameState,
  computedById: Record<CardInstanceId, ComputedCard>,
): void {
  for (const player of state.players) {
    const tempts = player.ringTempts ?? 0;
    const bearerId = player.ringBearerId;
    if (tempts < 1 || !bearerId) {
      continue;
    }
    const bearer = state.cards[bearerId];
    const computed = computedById[bearerId];
    if (!bearer || !computed || bearer.zone !== "battlefield") {
      continue;
    }
    // Tier one: "your Ring-bearer is legendary and can't be blocked by
    // creatures with greater power."
    if (!computed.characteristics.supertypes.includes("legendary")) {
      computed.characteristics.supertypes.push("legendary");
    }
    computed.ringBearer = true;
    if (tempts >= 2) {
      computed.grantedTriggers.push({
        event: "attacks",
        watch: "self",
        effects: [
          { kind: "draw", playerId: "controller", count: 1 },
          { kind: "discard", playerId: "controller", count: 1 },
        ],
        targetRequirements: [],
      });
    }
    if (tempts >= 3) {
      computed.grantedTriggers.push({
        event: "becomes_blocked",
        watch: "self",
        effects: [{ kind: "sacrifice_blocker_at_end_of_combat" }],
        targetRequirements: [],
      });
    }
    if (tempts >= 4) {
      computed.grantedTriggers.push({
        event: "deals_combat_damage_to_player",
        watch: "self",
        effects: [{ kind: "lose_life", playerId: "each_opponent", amount: 3 }],
        targetRequirements: [],
      });
    }
  }
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

/**
 * Every triggered ability an object has right now: the printed list first,
 * then anything a static granted it (Kaldra Compleat's equipped creature).
 *
 * ONE ADDRESS SPACE. A `triggerIndex` at or past the printed list's length
 * names a granted ability, so every site that resolves an index — the stack,
 * the targeting and mode prompts, the fuzzer, the client — reads this
 * instead of `definition.triggers`. A second address space was the
 * alternative and was rejected in wave 170; it would need a discriminator on
 * every candidate, stack object and prompt that carries an index.
 *
 * Pass `computedById` inside a loop over the battlefield: without it every
 * call recomputes the whole layer engine.
 *
 * Divergence: a grant is gone by the time the object is looked at from the
 * graveyard, so a GRANTED dies-trigger does not fire where a printed one
 * does. Real last-known-information (CR 603.10a) would keep it.
 */
export function triggersOf(
  state: GameState,
  cardId: CardInstanceId,
  computedById?: Record<CardInstanceId, ComputedCard>,
): CardTrigger[] {
  const card = state.cards[cardId];
  if (!card) {
    return [];
  }
  const printed = state.definitions[card.definitionId]?.triggers ?? [];
  const granted = (computedById ? computedById[cardId] : computedCard(state, cardId))
    ?.grantedTriggers;
  return granted && granted.length > 0 ? [...printed, ...granted] : printed;
}

/**
 * Every activated ability an object has right now: printed first, granted
 * after, one address space — see `triggersOf` for why.
 *
 * Only battlefield statics grant, so hand and graveyard activations
 * (cycling, Reassembling Skeleton) never reach a granted index.
 */
export function activatedOf(
  state: GameState,
  cardId: CardInstanceId,
  computedById?: Record<CardInstanceId, ComputedCard>,
): ActivatedAbility[] {
  const card = state.cards[cardId];
  if (!card) {
    return [];
  }
  const printed = state.definitions[card.definitionId]?.activated ?? [];
  // Urza's Saga: abilities the permanent was GIVEN by a resolved chapter.
  // Instance state, so they outlive the ability that granted them. Empty on
  // almost every permanent, and this is a hot path.
  const given = card.grantedActivatedAbilities;
  const granted = (computedById ? computedById[cardId] : computedCard(state, cardId))
    ?.grantedActivated;
  const all = given && given.length > 0 ? [...printed, ...given] : printed;
  const withStatic = granted && granted.length > 0 ? [...all, ...granted] : all;
  // Quicksilver Elemental: abilities copied from a target creature this turn.
  const untilEot = card.grantedActivatedUntilEot;
  return untilEot && untilEot.length > 0 ? [...withStatic, ...untilEot] : withStatic;
}

/**
 * The spread that carries a granted activated ability onto a stack object.
 * Same reason as `grantedTriggerSpread`: the grant can be gone by the time
 * the ability resolves.
 */
export function grantedActivatedSpread(
  state: GameState,
  cardId: CardInstanceId | null,
  index: number,
): { grantedActivated?: ActivatedAbility } {
  if (!cardId) {
    return {};
  }
  const card = state.cards[cardId];
  const printedCount = card ? state.definitions[card.definitionId]?.activated.length ?? 0 : 0;
  if (index < printedCount) {
    return {};
  }
  const granted = activatedOf(state, cardId)[index];
  return granted ? { grantedActivated: structuredClone(granted) } : {};
}

/**
 * The spread that carries a granted trigger onto a stack object as it is
 * queued. Empty for a printed trigger, which the definition still holds.
 */
export function grantedTriggerSpread(
  state: GameState,
  cardId: CardInstanceId | null,
  index: number,
): { grantedTrigger?: CardTrigger } {
  if (!cardId) {
    return {};
  }
  const card = state.cards[cardId];
  const printedCount = card ? state.definitions[card.definitionId]?.triggers.length ?? 0 : 0;
  if (index < printedCount) {
    return {};
  }
  const granted = triggersOf(state, cardId)[index];
  return granted ? { grantedTrigger: structuredClone(granted) } : {};
}

/** True when a remove-all-abilities effect (Humility) silences this object. */
export function abilitiesRemoved(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards[cardId];
  if (!card || card.zone !== "battlefield") {
    return false;
  }
  return computedCard(state, cardId)?.abilitiesRemoved ?? false;
}
