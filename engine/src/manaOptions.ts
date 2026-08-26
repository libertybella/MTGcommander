import { cardMatchesSubtype, computedCard, controlsGate } from "./characteristicsEngine";
import { commanderIdentityColors } from "./commanderIdentity";
import { triggerConditionHolds } from "./triggers";
import { COLOR_PIPS, MANA_COLORS } from "./mana";
import type { CardDefinition, CardInstanceId, GameState, ManaAbility, ManaColor } from "./types";

const BASIC_SUBTYPE_COLOR: Record<string, ManaColor> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
};

/**
 * State-aware mana abilities: the printed list (silenced by Humility), plus
 * abilities granted by statics (Cryptolith Rite), plus the intrinsic mana of
 * basic land subtypes the permanent has GAINED (Urborg — CR 305.6). Printed
 * basics already carry their color in `produces`, so only extra subtypes add.
 */
/** "Activate only if you control a Swamp" on a mana ability (Cabal-class). */
/** Mox Amber / Bloom Tender: colors among controlled permanents. */
export function colorsAmongControlled(
  state: GameState,
  controllerId: string,
  scope: "legendary" | "legendary_permanents" | "permanents",
): ManaColor[] {
  const found = new Set<string>();
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
      continue;
    }
    const traits = computedCard(state, card.id)?.characteristics;
    if (!traits) {
      continue;
    }
    if (scope === "legendary" || scope === "legendary_permanents") {
      const legal =
        traits.supertypes.includes("legendary") &&
        (scope === "legendary_permanents" ||
          traits.types.includes("creature") ||
          traits.types.includes("planeswalker"));
      if (!legal) {
        continue;
      }
    }
    for (const color of traits.colors) {
      found.add(color);
    }
  }
  return MANA_COLORS.filter((color) => found.has(color));
}

/** Exotic Orchard / Reflecting Pool: what a set of lands could produce.
 * Board-aware abilities on those lands are skipped rather than resolved
 * (Pool looking at Pool) — a documented approximation avoiding recursion. */
function producibleLandColors(
  state: GameState,
  controllerId: string,
  which: "opponents" | "own",
): ManaColor[] {
  const found = new Set<ManaColor>();
  for (const card of Object.values(state.cards)) {
    if (card.zone !== "battlefield") {
      continue;
    }
    const mine = card.controllerId === controllerId;
    if (which === "opponents" ? mine : !mine) {
      continue;
    }
    if (!(computedCard(state, card.id)?.characteristics.types ?? []).includes("land")) {
      continue;
    }
    for (const ability of manaAbilitiesUngated(state, card.id)) {
      if (ability.anyColorAmong || ability.producesColorsAmong) {
        continue;
      }
      if (ability.producesAnyColor) {
        for (const color of COLOR_PIPS) {
          found.add(color);
        }
        continue;
      }
      for (const color of ability.producesOptions) {
        found.add(color);
      }
      for (const color of MANA_COLORS) {
        if ((ability.produces[color] ?? 0) > 0) {
          found.add(color);
        }
      }
    }
  }
  return MANA_COLORS.filter((color) => found.has(color));
}

/** The legal picks for an anyColorAmong mana ability, by scope. */
/** Command Tower: colors of mana symbols across a player's commanders'
 * printed costs and rules text — a close reading of CR 903.4 identity
 * (color indicators and back faces are not consulted; documented). */
export { commanderIdentityColors };

export function manaChoiceColors(
  state: GameState,
  controllerId: string,
  scope: NonNullable<ManaAbility["anyColorAmong"]>,
  sourceId?: CardInstanceId,
): ManaColor[] {
  if (scope === "imprinted") {
    // Chrome Mox: the colours of the cards exiled WITH this permanent.
    // Nothing imprinted means no colours, so the gate refuses the tap —
    // an unimprinted Mox taps for nothing, which is the card.
    const source = sourceId ? state.cards[sourceId] : undefined;
    const found = new Set<string>();
    for (const imprintedId of source?.imprintedCardIds ?? []) {
      const definition = state.definitions[state.cards[imprintedId]?.definitionId ?? ""];
      for (const color of definition?.characteristics.colors ?? []) {
        found.add(color);
      }
    }
    return (["W", "U", "B", "R", "G"] as const).filter((color) => found.has(color));
  }
  if (scope === "legendary" || scope === "legendary_permanents") {
    return colorsAmongControlled(state, controllerId, scope);
  }
  if (scope === "commander_identity") {
    return commanderIdentityColors(state, controllerId);
  }
  if (scope === "opponent_lands") {
    // "any color": colorless is not a color (CR 107.4c).
    return producibleLandColors(state, controllerId, "opponents").filter((color) => color !== "C");
  }
  // Reflecting Pool says "any type" — colorless counts.
  return producibleLandColors(state, controllerId, "own");
}

function manaGateSatisfied(
  state: GameState,
  controllerId: string,
  ability: ManaAbility,
  sourceId?: CardInstanceId,
): boolean {
  // Heraldic Banner with no chosen color (never chosen, e.g. an override
  // placement) can't add anything.
  if (ability.producesChosenColor && sourceId && !state.cards[sourceId]?.chosenColor) {
    return false;
  }
  // Mox Amber / Exotic Orchard: an empty choice set means no mana at all.
  if (
    ability.anyColorAmong &&
    manaChoiceColors(state, controllerId, ability.anyColorAmong, sourceId).length === 0
  ) {
    return false;
  }
  // Bloom Tender with a colorless board would tap for nothing.
  if (
    ability.producesColorsAmong &&
    colorsAmongControlled(state, controllerId, "permanents").length === 0
  ) {
    return false;
  }
  // Springleaf Drum, Urza: the cost needs an untapped controlled permanent
  // of the named type.
  const tapCost = manaAbilityTapCost(ability);
  if (tapCost) {
    const fodder = Object.values(state.cards).some(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === controllerId &&
        !card.tapped &&
        (computedCard(state, card.id)?.characteristics.types ?? []).includes(tapCost.type),
    );
    if (!fodder) {
      return false;
    }
  }
  // Mox Opal: "Activate only if you control three or more artifacts."
  if (ability.requiresCount) {
    const { what, atLeast } = ability.requiresCount;
    const count = Object.values(state.cards).filter(
      (card) =>
        card.zone === "battlefield" &&
        card.controllerId === controllerId &&
        (state.definitions[card.definitionId]?.characteristics.types ?? []).includes(what),
    ).length;
    if (count < atLeast) {
      return false;
    }
  }
  // Uthros: a Station threshold — this many charge counters on the source.
  if (ability.requiresManaCounters && sourceId) {
    const have = state.cards[sourceId]?.counters[ability.requiresManaCounters.counter] ?? 0;
    if (have < ability.requiresManaCounters.atLeast) {
      return false;
    }
  }
  // Shrine of the Forsaken Gods: the shared condition vocabulary, on a mana
  // ability rather than an activated one.
  if (
    ability.requiresCondition &&
    !triggerConditionHolds(state, controllerId, ability.requiresCondition, undefined, sourceId)
  ) {
    return false;
  }
  const gate = ability.requiresControlled;
  return gate ? controlsGate(state, controllerId, gate) : true;
}

/** The full ability list before gate filtering. producibleLandColors uses
 * this directly — running the gates there would recurse (a Reflecting Pool
 * scanning its own lands re-gates the Pool itself). */
function manaAbilitiesUngated(state: GameState, cardId: CardInstanceId): ManaAbility[] {
  const card = state.cards[cardId];
  const definition = card ? state.definitions[card.definitionId] : undefined;
  if (!card || !definition) {
    return [];
  }
  if (card.zone !== "battlefield") {
    return manaAbilitiesOf(definition);
  }
  const computed = computedCard(state, cardId);
  if (computed?.abilitiesRemoved) {
    return [...(computed?.grantedMana ?? [])];
  }
  // Urza's Saga: chapter I gives it "{T}: Add {C}", which is a MANA
  // ability and must never use the stack — so it joins the list here
  // rather than among the activated ones.
  const given = card.grantedManaAbilities;
  const granted = computed?.grantedMana;
  // This runs constantly. Both extras are empty on almost every permanent,
  // so the common case keeps the printed array rather than rebuilding it.
  const abilities =
    (given && given.length > 0) || (granted && granted.length > 0)
      ? [...manaAbilitiesOf(definition), ...(given ?? []), ...(granted ?? [])]
      : manaAbilitiesOf(definition);
  if (computed?.characteristics.types.includes("land")) {
    const printedColors = new Set<ManaColor>();
    for (const ability of abilities) {
      for (const color of MANA_COLORS) {
        if ((ability.produces[color] ?? 0) > 0) {
          printedColors.add(color);
        }
      }
      for (const color of ability.producesOptions) {
        printedColors.add(color);
      }
      if (ability.producesAnyColor) {
        for (const color of COLOR_PIPS) {
          printedColors.add(color);
        }
      }
    }
    for (const subtype of computed.characteristics.subtypes) {
      const color = BASIC_SUBTYPE_COLOR[subtype];
      if (color && !printedColors.has(color)) {
        abilities.push({
          produces: { [color]: 1 },
          producesOptions: [],
          producesAnyColor: false,
          damageToController: 0,
        });
        printedColors.add(color);
      }
    }
  }
  return abilities;
}

export function manaAbilitiesFor(state: GameState, cardId: CardInstanceId): ManaAbility[] {
  const card = state.cards[cardId];
  if (!card) {
    return [];
  }
  const abilities = manaAbilitiesUngated(state, cardId);
  if (card.zone !== "battlefield") {
    return abilities;
  }
  return abilities.filter(
    (ability) =>
      manaGateSatisfied(state, card.controllerId, ability, cardId) &&
      sacrificeFodderAvailable(state, card.controllerId, ability),
  );
}

/**
 * Does this mana ability charge something beyond tapping the permanent?
 *
 * A costed ability is never auto-tapped and contributes nothing to potential
 * mana — the auto-tapper would otherwise pay a Springleaf Drum's {1}, or
 * discard a Lion's Eye Diamond's hand, to buy mana nobody asked for.
 *
 * This used to be spelled out at each of its call sites as a chain of
 * `costMana || costSacrifice || costTapCreature`, and a chain like that is a
 * hand-written copy of a list: adding a fifth cost means finding all of them,
 * and the one that is missed silently spends it. One predicate, so a new
 * cost is opted in once.
 */
export function manaAbilityIsCosted(ability: ManaAbility): boolean {
  return Boolean(
    ability.costMana ||
      ability.costSacrifice ||
      manaAbilityTapCost(ability) ||
      ability.costDiscardHand,
  );
}

/**
 * The "tap another untapped permanent you control" cost, as one reading.
 * Springleaf Drum wants a creature, Urza wants an artifact, Relic of Legends
 * wants a legendary creature. Every consumer asks here, so adding a third
 * type is one line rather than a hunt for the sites that test the flags.
 */
export function manaAbilityTapCost(
  ability: ManaAbility,
): { type: "creature" | "artifact"; legendaryOnly: boolean } | null {
  if (ability.costTapCreature) {
    return { type: "creature", legendaryOnly: ability.costTapCreatureLegendary === true };
  }
  if (ability.costTapArtifact) {
    return { type: "artifact", legendaryOnly: false };
  }
  return null;
}

/** Phyrexian Altar-class: the sacrifice-cost ability needs legal fodder. */
function sacrificeFodderAvailable(
  state: GameState,
  controllerId: string,
  ability: ManaAbility,
): boolean {
  const scope = ability.costSacrifice;
  if (!scope) {
    return true;
  }
  return Object.values(state.cards).some((card) => {
    if (card.zone !== "battlefield" || card.controllerId !== controllerId) {
      return false;
    }
    if (
      ability.costSacrificeSubtype !== undefined &&
      !cardMatchesSubtype(state, card.id, ability.costSacrificeSubtype)
    ) {
      return false;
    }
    const types = state.definitions[card.definitionId]?.characteristics.types ?? [];
    // Skirk Prospector: "Sacrifice a Goblin" names no card type — the subtype
    // filter above is the whole test.
    if (scope === "permanent") {
      return true;
    }
    if (scope === "treasure") {
      return (
        state.definitions[card.definitionId]?.characteristics.subtypes ?? []
      ).includes("treasure");
    }
    if (scope === "creature") {
      return types.includes("creature");
    }
    if (scope === "artifact") {
      return types.includes("artifact");
    }
    if (scope === "land") {
      return types.includes("land");
    }
    return types.includes("creature") || types.includes("artifact");
  });
}

export function manaAbilitiesOf(definition: CardDefinition): ManaAbility[] {
  if (definition.manaAbilities.length > 0) {
    return definition.manaAbilities;
  }
  if (definition.producesAnyColor) {
    return [
      {
        produces: {},
        producesOptions: [],
        producesAnyColor: true,
        damageToController: 0,
      },
    ];
  }
  if (definition.producesOptions.length > 0) {
    return [
      {
        produces: {},
        producesOptions: [...definition.producesOptions],
        producesAnyColor: false,
        damageToController: 0,
      },
    ];
  }
  if (MANA_COLORS.some((color) => (definition.produces[color] ?? 0) > 0)) {
    return [
      {
        produces: { ...definition.produces },
        producesOptions: [],
        producesAnyColor: false,
        damageToController: 0,
      },
    ];
  }
  return [];
}

export function manaAbilityAmount(ability: ManaAbility): number {
  return ability.count && ability.count > 0 ? ability.count : 1;
}

export function manaTapOptionsFor(
  ability: ManaAbility,
  state?: GameState,
  controllerId?: string,
  sourceId?: CardInstanceId,
): ManaColor[] | null {
  // Mox Amber / Exotic Orchard / Reflecting Pool: the choice is limited to
  // what the board offers. Without state (client preview) every pip shows;
  // the server validates.
  if (ability.anyColorAmong) {
    return state && controllerId
      ? manaChoiceColors(state, controllerId, ability.anyColorAmong, sourceId)
      : [...COLOR_PIPS];
  }
  if (ability.producesAnyColor) {
    return [...COLOR_PIPS];
  }
  if (ability.producesOptions.length > 0) {
    return [...ability.producesOptions];
  }
  return null;
}

export function manaTapOptions(definition: CardDefinition): ManaColor[] | null {
  const abilities = manaAbilitiesOf(definition);
  if (abilities.length !== 1) {
    return null;
  }
  return manaTapOptionsFor(abilities[0]!);
}

export function canTapForMana(definition: CardDefinition): boolean {
  return manaAbilitiesOf(definition).length > 0;
}
